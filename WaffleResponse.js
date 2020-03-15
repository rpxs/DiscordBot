const { randomFromArray } = require('./WaffleUtil');

class WaffleResponse {

    // Waffle colour spectrum
    colors = [0x8B5F2B, 0x986C33, 0xA5793D, 0xB08646, 0xBB9351, 0xC69D4E, 0xD0A74B, 0xD9B249, 0xE2BE47, 0xEBCA46, 0xF3D745];

    constructor(response) {
        this.response = response || '';
        this.error = '';
        this.errorLocale = '';
        this.isError = false;
        this.isLoggable = true;
        this.isSendable = true;
        this.isDirectReply = false;
        this.logResponseLimit = -1;
    }

    setEmbeddedResponse(options = {}) {
        const defaultOptions = {
            color: randomFromArray(this.colors),
        }
        const embed = Object.assign(defaultOptions, options);
        return this.setResponse({ embed });
    }

    setError(error) {
        this.error = error;
        return this.setIsError(this.error ? true : false);
    }

    setErrorLocale(errorLocale) {
        this.errorLocale = errorLocale;
        return this.setIsError(this.errorLocale ? true : false);
    }

    setIsError(isError) {
        this.isError = isError;
        return this;
    }

    setIsLoggable(isLoggable) {
        this.isLoggable = isLoggable;
        return this;
    }

    setIsSendable(isSendable) {
        this.isSendable = isSendable;
        return this;
    }

    setIsDirectReply(isDirectReply) {
        this.isDirectReply = isDirectReply;
        if (isDirectReply) {
            this.setIsSendable(true);
        }
        return this;
    }

    setLogResponseLimit(limit) {
        this.logResponseLimit = Math.max(limit || 0, 0);
        return this;
    }

    setResponse(response) {
        this.response = response;
        return this;
    }

    async reply(msg) {
        if (msg && this.isSendable && this.response) {
            if (this.isDirectReply) {
                await msg.reply(this.response);
            }
            else await msg.channel.send(this.response);
        }
        // Log results without blocking main thread
        const now = new Date().toISOString();
        setTimeout(() => {
            if (this.isLoggable) {
                const logger = this.isError ? console.error : console.log;
                const username = msg && msg.member ? msg.member.user.username : 'unknownUser';
                const errorLocale = this.errorLocale ? ` | ${this.errorLocale}` : '';
                const logError = this.error ? `\n__ERR__ ${this.error}` : '';
                const logResponse = this.logResponseLimit > -1 ?
                    `${this.response.substr(0, this.logResponseLimit)}${this.logResponseLimit < this.response.length ? `... +${this.response.length - this.logResponseLimit} characters` : ''}` :
                    this.response;
                logger(`[${now} | ${username}${errorLocale}] ${logResponse}${logError}`);
            }
        }, 100);
        return this;
    }
}

module.exports = WaffleResponse;