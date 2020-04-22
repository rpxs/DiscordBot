const ytdl = require('ytdl-core');
const yts = require('yt-search');

const MusicQueue = require('./MusicQueue');
const WaffleResponse = require('../message/WaffleResponse');
const { getSafe, randomMusicEmoji, retry, zeroWidthSpaceChar } = require('../util/WaffleUtil');
const { highWaterMarkBitShift } = require('../../configWaffleBot.json').music;

class WaffleMusic {
    constructor(client) {
        this.musicQueue = new MusicQueue();
        this.client = client;
    }

    getSimpleQueue() {
        if (this.musicQueue.isEmpty()) {
            return [];
        }
        const queue = this.musicQueue.getQueue();
        return queue.map(item => {
            const { title, videoId } = item.info.player_response.videoDetails
            const { author }  = item.msg;
            return { title, videoId, author };
        });
    }

    isInVoiceChannel() {
        return this.client.voice && this.client.voice.connections.first();
    }

    join(msg, args) {
        const wr = new WaffleResponse();
        if (!args || !args[0]) {
            return wr.setResponse('Please provide a valid voice channel name').reply(msg);
        }
        const channelToJoin = args[0];
        const validChannels = [];
        // Find voice channel to join
        msg.guild.channels.cache. forEach((channel, id) => {
            if (channel.type === 'voice' && channel.name === channelToJoin) {
                validChannels.push(channel);
            }
        });
        if (!validChannels || !validChannels[0]) {
            return wr.setResponse('Please provide an accurate voice channel name').reply(msg);
        }

        const dispatcher = this._getDispatcher();
        if (dispatcher && dispatcher.paused) {
            return wr.setResponse('Please Unpause me to join another channel (:waffle: unpause)').reply(msg);
        }
        validChannels[0].join()
            .then(connection => {
                connection.on('error', err => {
                    return wr.setResponse(`⚠️ Connection Error occurred in ${channelToJoin}. You may have to use 'waffle join ${channelToJoin}' to join the voice channel again.`).setError(err).reply(msg);
                });
                connection.on('debug', d => {
                    if (getSafe(() => !d.startsWith("[WS] >> {\"op\":3,\"d\"") && !d.startsWith("[WS] << {\"op\":6,\"d\""), true)) {
                        console.log('VOICE_CONNECTION_DEBUG: ', d);
                    }
                });
                wr.setResponse(`✅ ~ Successfully connected to channel '${channelToJoin}'!`).reply(msg);
            })
            .catch(err => wr.setResponse(`🚫 ~ Failed to connect to channel '${channelToJoin}'`).setError(err).reply(msg));
    }

    pause(msg) {
        return new Promise(resolve => {
            let wr = this._verifyInVoiceChannel(msg);
            if (wr.isError) return resolve(wr);

            wr = this._verifyQueueIsNotEmpty();
            if (wr.isError) return resolve(wr);

            return resolve(this._pause());
        }).catch(err => {
            return new WaffleResponse('⚠️ *unknown error occurred*').setErrorLocale('pause').setError(err).setIsSendable(false);
        });
    }

    play(msg, args, options = {}) {
        return new Promise(resolve => {
            options = Object.assign({
                skipUserValidation: false,
            }, options);

            let wr = this._verifyInVoiceChannel(msg, options);
            if (wr.isError) return resolve(wr);

            // No argument provided
            if (!args[0] || !args.join('')) {
                // check if there's a song to unpause
                const dispatcher = this._getDispatcher();
                if (dispatcher && dispatcher.paused) {
                    dispatcher.resume();
                    const { title } = this.musicQueue.peek().info.player_response.videoDetails;
                    return resolve(wr.setResponse(`*unpaused ${title}*`));
                }
                return resolve(wr.setResponse('*To play music, please provide a YouTube link or text*').setIsError(true));
            }

             // Play music
             return this._getYTInfo(args).then(wr => resolve(wr.isError ? wr : this._play({ info: wr.response, msg })));
        }).catch(err => {
            return new WaffleResponse('⚠️ *unknown error occurred*').setErrorLocale('play').setError(err).setIsSendable(false);
        });
    }

    queue(msg) {
        return new Promise(resolve => {
            const wr = this._verifyQueueIsNotEmpty();
            if (wr.isError) return resolve(wr);

            const embeddedMessage = this._getEmbeddedQueueMessage();
            return resolve(wr.setEmbeddedResponse(embeddedMessage));
        })
        .catch(err => {
            return new WaffleResponse('⚠️ *unknown error occurred*').setErrorLocale('queue').setError(err).setIsSendable(false);
        });
    }

    removeLast(msg) {
        const wr = new WaffleResponse();
        return new Promise(resolve => {
            const { id } = msg.member;
            let queuePosition = -1;
            const queue = this.musicQueue.getQueue();
            for (let i = queue.length - 1 ; i >= 0 ; i-- ) {
                if (queue[i].msg.member.id == id) {
                    queuePosition = i;
                    break;
                }
            }
            // Nothing in queue from member
            if (queuePosition == -1) {
                return resolve(wr.setResponse(`😕 You have nothing to be oopsy about.`));
            }
            return resolve(this.skip(msg, queuePosition));
        })
        .catch(err => {
            return new WaffleResponse('⚠️ *unknown error - please try again').setErrorLocale('removeLast').setError(err).setIsSendable(false);
        });
    }

    repeat(msg) {
        return new Promise(resolve => {
            let wr = this._verifyInVoiceChannel(msg);
            if (wr.isError) return resolve(wr);

            wr = this._verifyQueueIsNotEmpty();
            if (wr.isError) return resolve(wr);

            const { info } = this.musicQueue.peek();
            return resolve(this._play({ info, msg }));
        }).catch(err => {
            return new WaffleResponse('⚠️ *unknown error - please try again').setErrorLocale('repeat').setError(err).setIsSendable(false);
        });
    }

    skip(msg, queuePosition = 0) {
        return new Promise(resolve => {
            let wr = this._verifyInVoiceChannel(msg);
            if (wr.isError) return resolve(wr);

            wr = this._verifyQueueIsNotEmpty();
            if (wr.isError) return resolve(wr);

            // Verify there is a song at given queue position
            if (queuePosition > this.musicQueue.length() - 1) {
                return resolve(wr.setResponse(`🚫 No songs in queue position **#${queuePosition}**`));
            }

            wr = this._verifySongSkipPermission(msg, queuePosition);
            if (wr.isError) return resolve(wr);

            // Remove from queue if queuePosition is specified
            if (queuePosition > 0) {
                const queueItem = this.musicQueue.dequeueAt(queuePosition);
                const { title } = queueItem.info.player_response.videoDetails;
                return resolve(wr.setResponse(`🗑 removed '*${title}*' from queue`));
            }

            // Otherwise, end current song
            return this._endDispatcher().then(wr => resolve(wr.setResponse("Skipped / Stopped").setIsSendable(false)));
        })
        .catch(err => {
            return new WaffleResponse('⚠️ *unknown error - please try again').setErrorLocale('skip').setError(err).setIsSendable(false);
        });
    }

    song(msg) {
        return new Promise(resolve => {
            let wr = this._verifyQueueIsNotEmpty();
            if (wr.isError) return resolve(wr);

            return resolve(wr.setEmbeddedResponse(this._getEmbeddedQueueMessage(false)));
        })
        .catch(err => {
            return new WaffleResponse('⚠️ *unknown error - please try again').setErrorLocale('song').setError(err).setIsSendable(false);
        })
    }

    unpause(msg) {
        return new Promise(resolve => {
            let wr = this._verifyInVoiceChannel(msg);
            if (wr.isError) return resolve(wr);

            wr = this._verifyQueueIsNotEmpty();
            if (wr.isError) return resolve(wr);

            return resolve(this._unpause());
        })
        .catch(err => {
            return new WaffleResponse('⚠️ *unknown error - please try again').setErrorLocale('unpause').setError(err);
        });
    }

    _buildEmbeddedVideoMessage(header, title, videoId, username, fields = []) {
        const emoji = randomMusicEmoji();
        const queueLen = this.musicQueue.length() - 1;
        const queueLenStr = queueLen === 1 ? `is **1** song` : `are **${queueLen}** songs`;
        const description = `Requested by **${username}**. There ${queueLenStr} in the queue.`;
        const embeddedMessage = {
            author: {
                name: header,
            },
            title: `${emoji}  ${title}`,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            description,
            thumbnail: {
                url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            },
            fields,
        };
        return embeddedMessage;
    }

    async _endDispatcher() {
        const wr = new WaffleResponse();
        const dispatcher = this._getDispatcher();
        if (dispatcher) {
            if (dispatcher.paused) await dispatcher.resume();
            dispatcher.end();
        }
        return wr;
    }

    _getEmbeddedQueueMessage(includeFields = true) {
        const { info, msg } = this.musicQueue.peek();
        const { username } = msg.author;
        const { title, videoId } = info.player_response.videoDetails;
        const dispatcher = this._getDispatcher();
        const playState = dispatcher && dispatcher.paused ? 'Paused' : 'Now Playing';
        let fields = [];
        if (includeFields) {
            fields = this.getSimpleQueue().slice(1).map((r, i) => {
                return {
                    name: `#${i + 1} ~ by ${r.author.username}`,
                    value: `${r.title}`,
                    inline: false
                }
            });
            if (fields.length > 0) {
                fields.unshift({ name: zeroWidthSpaceChar, value: '***Queue***'});
            }
        }
        return this._buildEmbeddedVideoMessage(playState, title, videoId, username, fields);
    }

    _getYTInfo(args) {
        const ytLink = args[0];
        // Youtube link provided
        if (['youtube', 'youtu.be'].some(substring => ytLink.includes(substring))) {
            return this._getYTInfoViaLink(ytLink);
        }
        // String provided
        return this._getYTInfoViaString(args);

    }

    _getYTInfoViaLink(ytLink)  {
        const wr = new WaffleResponse();
        if (!ytdl.validateURL(ytLink)) {
            return Promise.resolve(wr.setResponse(`Invalid url '${ytLink}'. Imma need some valid blueberries, bruh!`).setIsError(true));
        }
        return ytdl.getInfo(ytLink).then(response => wr.setResponse(response));
    }

    _getYTInfoViaString(args) {
        const argString = args.join(' ');
        const options = { query: argString, pageStart: 1, pageEnd: 1 };
        const searchFunc = () => yts(options)
            .then(res => getSafe(() => res.videos || [], []))
            .then(videos => {
                if (!videos || !videos[0]) {
                    console.error(`__E: No videos found... retrying`);
                    throw new Error('no videos found');
                }
                return videos;
            });
        return retry(searchFunc, 3)
            .then(videos => {
                const filteredVideos = videos.filter(video => {
                    // Ignore Youtube Movies Hardcode
                    return video.author.id !== 'UClgRkhTL3_hImCAmdLfDE4g';
                });
                return this._getYTInfoViaLink(filteredVideos[0].url);
            })
            .catch(err => {
                return new WaffleResponse().setResponse(`Could not find any results for '${argString}'. Try editing your search.`).setError(err);
            });
    }

    _getVoiceConnection() {
        return this.isInVoiceChannel() ? this.client.voice.connections.first() : undefined;
    }

    _getDispatcher() {
        const voiceConnection = this._getVoiceConnection();
        return !voiceConnection ? undefined : voiceConnection.dispatcher;
    }

    _pause() {
        const wr = new WaffleResponse();
        const dispatcher = this._getDispatcher();
        if (dispatcher && !dispatcher.paused) {
            dispatcher.pause();
            const { title } = this.musicQueue.peek().info.player_response.videoDetails;
            return wr.setResponse(`*paused ${title}*`);
        }
        return wr.setResponse(`Can't pause what's already paused, genius`).setIsError(true);
    }

    _play(queueItem) {
        // Attempt to queue song
        const wr = this.musicQueue.queue(queueItem);
        if (wr.isError) return wr;

        const queueLen = this.musicQueue.length();

        // Initiate recursive play
        if (queueLen === 1) {
            this._playRecursively();
            return wr.setResponse('Initiated Recursive Play').setIsSendable(false);
        // Else, Ping user that their song has been added to the queue
        } else {
            const { title, videoId } = queueItem.info.player_response.videoDetails;
            const { username } = queueItem.msg.author;
            const header = `Queued in position #${queueLen - 1}`;
            const embeddedMessage = this._buildEmbeddedVideoMessage(header, title, videoId, username);
            return wr.setEmbeddedResponse(embeddedMessage);
        }
    }

    _playRecursively() {
        const wr = new WaffleResponse();
        const { info, msg } = this.musicQueue.peek();
        const { title, videoId } = info.player_response.videoDetails;
        const ytLink = `https://www.youtube.com/watch?v=${videoId}`;

        const connection = this._getVoiceConnection();
        if (!connection) return ;

        const readableStream = ytdl.downloadFromInfo(info, { quality: 'highestaudio', highWaterMark: 1 << highWaterMarkBitShift }); /* ~4mbs */

        readableStream.on('error', err => {
            wr.setResponse(`'${title}' encountered an error while streaming. skipping.`).setError(err).reply(msg);
            const dispatcher = this._getDispatcher();
            if (dispatcher) dispatcher.end();
        });
        readableStream.on('debug', d => {
            console.log('READABLE_STREAM_DEBUG: ', d);
        });
        readableStream.on('close', c => {
            console.log('READABLE_STREAM_CLOSE: ', c);
        });

        const dispatcher = connection.play(readableStream, { highWaterMark: 1 })
        dispatcher.on('start', s => {
                const embeddedMessage = this._getEmbeddedQueueMessage(false);
                console.log('DISPATCHER_START: ', s);
                wr.setEmbeddedResponse(embeddedMessage).reply(msg);
                this.client.user.setPresence({ activity: { name: `${title} 🎧`, type: 'PLAYING', url: ytLink }});
            });
        dispatcher.on('finish', f => {
                wr.setResponse(`**${title}** has finished playing`).setIsSendable(false).reply(msg);
                this.client.user.setPresence({ activity: { name: '', type: '' }});
                console.log('DISPATCHER_FINISH: ', f);
                this.musicQueue.dequeue();
                if (!this.musicQueue.isEmpty()) {
                    this._playRecursively();
                }
            });
        dispatcher.on('error', err => {
                wr.setResponse(`'${title}' encountered an error while streaming. skipping.`).setError(err).reply(msg);
                this.client.user.setPresence({ activity: { name: '', type: '' }});
                console.log('DISPATCHER_ERROR: ', err);
                this.musicQueue.dequeue();
                if (!this.musicQueue.isEmpty()) {
                    this._playRecursively();
                }
            });
        dispatcher.on('debug', d => {
            console.log('DISPATCHER_DEBUG: ', d);
        });
        dispatcher.on('close', c => {
            console.log('DISPATCHER_CLOSE: ', c);
        });
    }

    _unpause() {
        const wr = new WaffleResponse();
        const dispatcher = this._getDispatcher();
        if (dispatcher && dispatcher.paused) {
            dispatcher.resume();
            const { title } = this.musicQueue.peek().info.player_response.videoDetails;
            return wr.setResponse(`*unpaused ${title}*`);
        }
        return wr.setResponse(`*can't unpause what's not paused, genius.*`).setIsError(true);
    }

    _verifySongSkipPermission(msg, songIndex) {
        const { member } = msg;
        const wr = new WaffleResponse();

        // Admins and moderators have default full permission
        if (member.hasPermission('KICK_MEMBERS')) {
            return wr;
        }

        const { id: requesterId } = this.musicQueue.getQueue()[songIndex].msg.member;

        // User is the requester of the song
        if (member.id == requesterId) {
            return wr;
        }

        // Original requester is no longer in the voice channel
        if (!msg.member.voice.channel.members.has(requesterId)) {
            return wr;
        }

        // Not allowed!
        return wr.setResponse(`🚫 *You don't have permission to do that*`).setIsError(true);
    }

    _verifyQueueIsNotEmpty() {
        const wr = new WaffleResponse();
        if (this.musicQueue.isEmpty()) {
            wr.setResponse(`*No songs are currently in the queue*`).setIsError(true);
        }
        return wr;
    }

    _verifyInVoiceChannel(msg, options = {}) {
        // Overwrite default options
        const defaultOptions = {
            skipUserValidation: false,
        }
        options = Object.assign(defaultOptions, options);
        const wr = new WaffleResponse();

        // Client is not connected to a voice channel
        const voiceConnection = this._getVoiceConnection();
        if (!voiceConnection) {
            return wr.setResponse(`⚠️ Have waffle join a voice channel first: ':waffle: **join** ***myVoiceChannel***'`).setIsError(true);
        }
        const { id, name } = voiceConnection.channel;
        // Member is not in the bot's voice channel
        if (!options.skipUserValidation &&
            (!msg.member.voice || !msg.member.voice.channel || msg.member.voice.channel.id != id)) {
            return wr.setResponse(`⚠️ You must be in the voice channel '${name}' to do that!`).setIsError(true);
        }
        return wr;
    }
}

module.exports = WaffleMusic;