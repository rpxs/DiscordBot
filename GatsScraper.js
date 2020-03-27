const Nightmare = require('nightmare');
const WaffleResponse = require('./WaffleResponse');
const { getSafe, zeroWidthSpaceChar } = require('./WaffleUtil');
const axios = require('axios').default;
const cheerio = require('cheerio');

class GatsScraper {
  gatsCache = {
    highScoresData: {
      siteUrl: "https://gats.io/",
      lastRequest: 0,
      data: {}
    }
  };
  gatsLogoUrl = 'https://stats.gats.io/img/gats_logo.png';

  clanstats(args) {
    const wr = new WaffleResponse();
    return new Promise(resolve => {
      if (!args || !args[0]) {
        return resolve(wr.setResponse('⚠️ Please provide a clan name argument. eg: KCGO'));
      }
      const clanName = args[0];

      this._requestClanStatsData(clanName)
        .then(allStats => {
          if (!allStats || !allStats.stats || !allStats.stats[0]) {
            return resolve(wr.setEmbeddedResponse({ description: `*No stats found for clan* **${clanName}**. Maybe you made a typo?` }));
          }
          const { stats, favoriteLoadouts } = allStats;
          const title = `Clan Stats for ${allStats.name}`;
          const description = stats.map(s => `**${s.stat}:** ${s.value}`).join('\n');
          const thumbnail = { url: favoriteLoadouts[0].imageUrl };
          const fields = [
            { name: zeroWidthSpaceChar, value: '***Favorite Loadouts***'},
            ...favoriteLoadouts.map(fl => { return { name: fl.stat, value: fl.value, inline: true } }),
            { name: zeroWidthSpaceChar, value: `[View these stats online](${allStats.url})` }
          ];
          return resolve(wr.setEmbeddedResponse({ title, description, thumbnail, fields }));
        });
    })
    .catch(err => {
      return wr.setResponse('⚠️ Unknown error occurred').setError(err).setIsSendable(false);
    });
  }

  getTopFive() {
    const wr = new WaffleResponse();
    const now = Date.now();
    // Only update cache if it's been more than 5 minutes
    if (now - this.gatsCache.highScoresData.lastRequest > 300000) {
      return Nightmare({ show: false, gotoTimeout: 15000, waitTimeout: 15000 })
        .goto(this.gatsCache.highScoresData.siteUrl)
        .wait("#highScoresData#highScoresData > br:nth-child(5)")
        .evaluate(() => document.getElementById("highScoresData").innerText)
        .end()
        .then(text => {
          let data = text.split("\n");
          data.shift();
          data = data.map(row => {
            const elems = row.split(" ");
            return {
              position: elems[0][0],
              player: elems[1].slice(0, -1),
              points: elems[2]
            };
          });
          this.gatsCache.highScoresData.lastRequest = now;
          this.gatsCache.highScoresData.data = data;
          return Promise.resolve(wr.setResponse(data));
        })
        .catch(err => {
          wr.setResponse("*⚠️ Failed to scrape gats for data*")
            .setErrorLocale("getTopFive")
            .setError(err);
          return Promise.reject(wr);
        });
    }
    return Promise.resolve(wr.setResponse(this.gatsCache.highScoresData.data));
  }

  playerstats(args) {
    const wr = new WaffleResponse();
    return new Promise(resolve => {
      if (!args || !args[0]) {
        return resolve(wr.setResponse('⚠️ Please provide a player name argument. eg: dorfnox'));
      }
      const playerName = args[0];

      this._requestPlayerStatsData(playerName)
        .then(allStats => {
          if (!allStats || !allStats.stats || !allStats.stats[0]) {
            return resolve(wr.setEmbeddedResponse({ description: `*No stats found for clan* **${playerName}**. Maybe you made a typo?` }));
          }
          const { stats, favoriteLoadouts } = allStats;
          const title = `Player Stats for ${allStats.name}`;
          const description = stats.map(s => `**${s.stat}:** ${s.value}`).join('\n');
          const thumbnail = { url: favoriteLoadouts[0].imageUrl };
          const fields = [
            { name: zeroWidthSpaceChar, value: '***Favorite Loadouts***'},
            ...favoriteLoadouts.map(fl => { return { name: fl.stat, value: fl.value, inline: true } }),
            { name: zeroWidthSpaceChar, value: `[View these stats online](${allStats.url})` }
          ];
          return resolve(wr.setEmbeddedResponse({ title, description, fields, thumbnail }));
        });
    })
    .catch(err => {
      console.log('ERRROR', err);
      return wr.setResponse('⚠️ Unknown error occurred').setError(err).setIsSendable(false);
    });
  }

  _requestClanStatsData(clanName) {
    const url = `https://stats.gats.io/clan/${clanName}`;
    return this._requestStatsData(url);
  }

  _requestPlayerStatsData(playerName) {
    const url = `https://stats.gats.io/${playerName}`;
    return this._requestStatsData(url);
  }

  _requestStatsData(url) {
    return axios.get(url)
      .then(response => response.data)
      .then(data => cheerio.load(data, { normalizeWhitespace: true }))
      .then(cdata => {
        // Collect proper name
        const name = getSafe(() => cdata('#pageContainer > div:nth-child(1) > div:nth-child(1) > h1').text().trim().split(' ')[0], 'unknown');

        // Collect Regular Stats
        const stats = cdata('#pageContainer > div:nth-child(1) > div:nth-child(1) > table > tbody > tr').map((_, elem) => {
          const stat = getSafe(() => elem.children[1].children[0].data.trim(), 'no stat');
          const value = getSafe(() => elem.children[3].children[0].data.trim(), 'no value');
          return { stat, value };
        }).get();

        // Collect Favorite Loadouts
        const favoriteLoadouts = cdata('#pageContainer > div:nth-child(1) > div:nth-child(2) > div > table > tbody > tr').map((_, elem) => {
          const stat = getSafe(() => elem.children[1].children[1].children[0].data.trim(), 'no stat');
          const value = getSafe(() => elem.children[1].children[3].children[0].data.trim(), 'no value');
          const imageUrl = getSafe(() => `https://stats.gats.io${elem.children[3].children[0].attribs.src.trim()}`, this.gatsLogoUrl);
          return { stat, value, imageUrl };
        }).get();

        return { url, name, stats, favoriteLoadouts };
      });
  }
}

module.exports = GatsScraper;