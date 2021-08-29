"use strict";

//Adds webserver for UptimeRobot to ping so Replit keeps this running
var http = require("http");
http
  .createServer(function (req, res) {
    res.write("Webhook is active");
    res.end();
  })
  .listen(8080);

const tslib = require("tslib");
const Discord = require("discord.js");
const node_fetch = tslib.__importDefault(require("node-fetch"));
const luxon = require("luxon");
const database = require("@replit/database");
const constants = require("./constants");
const logger = require("./logger");
const incidentData = new database();
const hook = setUpWebhook();
logger.logger.info(`Starting with ${hook.id}`);

function setUpWebhook() {
  if (process.env.DISCORD_WEBHOOK_URL) {
    var id = process.env.DISCORD_WEBHOOK_URL.slice(-87, -69);
    var token = process.env.DISCORD_WEBHOOK_URL.slice(-68);
    return new Discord.WebhookClient(id, token);
  } else if (
    process.env.DISCORD_WEBHOOK_ID &&
    process.env.DISCORD_WEBHOOK_TOKEN
  ) {
    logger.logger.warn(
      "DEPRECATION WARNING: ID and Token support will be removed soon. Please provide the webhook URL in the environment varible DISCORD_WEBHOOK_URL instead."
    );
    return new Discord.WebhookClient(
      process.env.DISCORD_WEBHOOK_ID,
      process.env.DISCORD_WEBHOOK_TOKEN
    );
  } else {
    logger.logger.error(
      "Unable to log in. Please provide the Webhook URL in the environment varible DISCORD_WEBHOOK_URL."
    );
    process.exit(1);
  }
}

function embedFromIncident(incident) {
  const color =
    incident.status === "resolved" || incident.status === "postmortem"
      ? constants.EMBED_COLOR_GREEN
      : incident.impact === "critical"
      ? constants.EMBED_COLOR_RED
      : incident.impact === "major"
      ? constants.EMBED_COLOR_ORANGE
      : incident.impact === "minor"
      ? constants.EMBED_COLOR_YELLOW
      : constants.EMBED_COLOR_BLACK;
  const affectedNames = incident.components.map((c) => c.name);
  const embed = new Discord.MessageEmbed()
    .setColor(color)
    .setTimestamp(new Date(incident.started_at))
    .setURL(incident.shortlink)
    .setTitle(incident.name)
    .setFooter(`Incident ${incident.id}`);
  for (const update of incident.incident_updates.reverse()) {
    const updateDT = luxon.DateTime.fromISO(update.created_at);
    const timeString = `<t:${Math.floor(updateDT.toSeconds())}:t>`;
    embed.addField(
      `${update.status.charAt(0).toUpperCase()}${update.status.slice(
        1
      )} (${timeString})`,
      update.body
    );
  }
  const descriptionParts = [`• Impact: ${incident.impact}`];
  if (affectedNames.length) {
    descriptionParts.push(`• Affected Components: ${affectedNames.join(", ")}`);
  }
  embed.setDescription(descriptionParts.join("\n"));
  return embed;
}

async function updateIncident(incident, messageID) {
  const embed = embedFromIncident(incident);
  try {
    const message = await (messageID
      ? hook.editMessage(messageID, '<@&868217413374722048>', embed)
      : hook.send('<@&868217413374722048>', embed));
    await incidentData.set(incident.id, {
      incidentID: incident.id,
      lastUpdate: luxon.DateTime.now().toISO(),
      messageID: message.id,
      resolved:
        incident.status === "resolved" || incident.status === "postmortem",
    });
  } catch (error) {
    if (messageID) {
      logger.logger.error(
        `error during hook update on incident ${incident.id} message: ${messageID}\n`,
        error
      );
      return;
    }
    logger.logger.error(
      `error during hook sending on incident ${incident.id}\n`,
      error
    );
  }
}

async function check() {
  var keys = await incidentData.list();
  if (keys.length == 0) {
    fillDatabaseSilently();
    return;
  }

  var _a;
  logger.logger.log("heartbeat", `❤`);
  try {
    const json = await node_fetch
      .default(`${constants.API_BASE}/incidents.json`)
      .then((r) => r.json());
    const { incidents } = json;
    for (const incident of incidents.reverse()) {
      const data = await incidentData.get(incident.id);
      if (!data) {
        logger.logger.log("new", `new incident: ${incident.id}`);
        void updateIncident(incident);
        continue;
      }
      const incidentUpdate = luxon.DateTime.fromISO(
        (_a = incident.updated_at) !== null && _a !== void 0
          ? _a
          : incident.created_at
      );
      if (luxon.DateTime.fromISO(data.lastUpdate) < incidentUpdate) {
        logger.logger.log("update", `update incident: ${incident.id}`);
        void updateIncident(incident, data.messageID);
      }
    }
  } catch (error) {
    logger.logger.error(`error during fetch and update routine:\n`, error);
  }
}

//If the databse is empty, loads the incidents into the database without posting messages
async function fillDatabaseSilently() {
  logger.logger.info(
    "Database is empty, loading incidents w/o posting to webhook"
  );
  try {
    const json = await node_fetch
      .default(`${constants.API_BASE}/incidents.json`)
      .then((r) => r.json());
    const { incidents } = json;
    for (const incident of incidents.reverse()) {
      logger.logger.log("new", `new incident: ${incident.id}`);
      await incidentData.set(incident.id, {
        incidentID: incident.id,
        lastUpdate: luxon.DateTime.now().toISO(),
        resolved:
          incident.status === "resolved" || incident.status === "postmortem",
      });
    }
  } catch (error) {
    logger.logger.error(`error during fetch and update routine:\n`, error);
  }
}

void check();
void setInterval(() => void check(), 4000);
