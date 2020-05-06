const ArgumentHandler = require("../message/ArgumentHandler");
const WaffleResponse = require("../message/WaffleResponse");
const ServerMailController = require("./ServerMailController");
const {
  modMailChannelCategoryName,
} = require("../../configWaffleBot.json").modMail;

class WaffleMail {
  static channelSliceLength = (modMailChannelCategoryName.length + 1) * -1;
  static discriminatorLength = 4;

  constructor(client) {
    this.client = client;
    this.serverMailController = new ServerMailController(client);
    this.closeChannelArgHandler = new ArgumentHandler().addCmds([
      "close",
      "end",
      "finish",
      "c c c"
    ]);
  }

  handleDM(msg) {
    // Validate user already has an existing mod mail open.
    this.serverMailController
      .init(msg)
      .then((userController) => {
        const { textChannel } = userController;
        return textChannel.send(msg.content);
      })
      .catch((err) => {
        if (err) {
          new WaffleResponse()
            .setError(err)
            .setEmbeddedResponse({ description: err })
            .reply(msg);
        }
      });
  }

  handleModChannel(msg) {
    // First figure out the user to DM
    const { channel, guild } = msg;
    const user = channel.name.slice(0, WaffleMail.channelSliceLength);
    const discriminator = user.slice(
      user.length - WaffleMail.discriminatorLength,
      user.length
    );
    const username = user.slice(
      0,
      user.length - WaffleMail.discriminatorLength
    );
    const guildMember = guild.members.cache.find(
      (m) =>
        m.user.username.toLowerCase() === username &&
        m.user.discriminator === discriminator
    );
    // Check if we should close the channel
    const argsParsed = this.closeChannelArgHandler.hasArgument(msg.content, true);
    if (argsParsed) {
      return new WaffleResponse().setEmbeddedResponse({ description: `Yes! Args parsed: ${argsParsed}` }).reply(msg);
    }
    if (!guildMember) {
      return new WaffleResponse()
        .setEmbeddedResponse({
          color: "#ff0028", // Ruddy
          description: `Unfortunately, ${username} no longer appears active in ${guild.name}. **Close** this channel with 'w close *reason*'.`,
        })
        .reply(msg);
    }
    guildMember.user
      .createDM()
      .then((dmChannel) =>
        this.serverMailController.initForAuthorDmChannelAndGuild(
          guildMember.user,
          dmChannel,
          guild
        )
      )
      .then((userController) => {
        const wr = new WaffleResponse();
        return userController.author
          .send(`**${msg.member.displayName}**: ${msg.content}`)
          .then(() => {
            // Feedback on mod channel to let staff know that message went through
            wr.setEmbeddedResponse({
              description: `:white_check_mark: message sent to ${userController.author.username}`,
            }).reply(msg);
          })
          .catch((err) =>
            wr
              .setError(err)
              .setEmbeddedResponse({
                description: `Unable to DM ${userController.author.name}. Here was the error: ${err}`,
              })
              .reply(msg)
          );
      })
      .catch((err) =>
        // Catches failure to intialize a DM channel
        new WaffleResponse()
          .setError(err)
          .setEmbeddedResponse({
            description: `🚫 Could not instantiate a DM channel with ${username}.\nLikely, the user is confirming an operation with WaffleMail at this very moment.`,
          })
          .reply(msg)
      );
  }
}

module.exports = WaffleMail;
