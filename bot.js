//  __   __  ___        ___
// |__) /  \  |  |__/ |  |  
// |__) \__/  |  |  \ |  |  

// This is the main file for the timeteller bot.

// Import Botkit's core features
const { Botkit } = require('botkit');
const { BotkitCMSHelper } = require('botkit-plugin-cms');

// Import a platform-specific adapter for slack.

const { SlackAdapter, SlackMessageTypeMiddleware, SlackEventMiddleware } = require('botbuilder-adapter-slack');
const moment = require("moment");
const momentTz = require("moment-timezone");

// Load process.env values from .env file
require('dotenv').config();

const adapter = new SlackAdapter({
    // REMOVE THIS OPTION AFTER YOU HAVE CONFIGURED YOUR APP!
    enable_incomplete: true,

    // parameters used to secure webhook endpoint
    verificationToken: process.env.VERIFICATION_TOKEN,
    clientSigningSecret: process.env.CLIENT_SIGNING_SECRET,  

    // auth token for a single-team app
    botToken: process.env.BOT_TOKEN,

    // credentials used to set up oauth for multi-team apps
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    scopes: ['bot'], 
    redirectUri: process.env.REDIRECT_URI,
 
    // functions required for retrieving team-specific info
    // for use in multi-team apps
    getTokenForTeam: getTokenForTeam,
    getBotUserByTeam: getBotUserByTeam,
});

// Use SlackEventMiddleware to emit events that match their original Slack event types.
adapter.use(new SlackEventMiddleware());

// Use SlackMessageType middleware to further classify messages as direct_message, direct_mention, or mention
adapter.use(new SlackMessageTypeMiddleware());


const controller = new Botkit({
    adapter: adapter,
    webhook_uri: "/slack/events"
});

const TIME_RX = /[1-9]\d?(([:. ]\d{2}([ ]?[a|p]m)?)|([ ]?[a|p]m))/i
const hasTimeString = (s) => TIME_RX.test(s)
const parseTime = (s) => s.match(TIME_RX)[0]
const clockEmoji = (m) => `:clock${(m.hours() % 12) || 12}:`
const normalizeTime = (s) => moment(s, 'h:mA').format('h:mm A')

controller.on('message', async (bot, event) => {
    const {text, user, channel, team, reference: { bot: { id: bot_id } }} = event;
    if ( bot_id === user) return;
    if (!hasTimeString(text)) return;
    const users = await bot.api.users.list({ team });
    const timezones = users.members.filter((member) => !(member.id === user))
        .map((user) => ({ offset: user.tz_offset / 60, label: user.tz_label}))
    const sender = users.members.find(member => member.id === user);
    // Sets the default timezone of the server to that of the message sender
    momentTz.tz.setDefault(sender.tz);
    const timeString = normalizeTime(parseTime(text));
    const parsedTime = moment(timeString, 'h:mm A');
    if (!parsedTime.isValid()) return;  
    const uniqueArray = Array.from(new Set(timezones.map(JSON.stringify))).map(JSON.parse);
    uniqueArray.forEach((timezoneInfo) => {
        const timeResponse = moment(parsedTime).utcOffset(timezoneInfo.offset).format("YYYY-MM-DD h:mm A");
        bot.api.chat.postMessage({ channel,
             text: `*${timeString}* is *${timeResponse}* in *${timezoneInfo.label}*.`, 
             asUser: false, 
             username: 'Tell my timezone', 
             iconEmoji: clockEmoji(parsedTime) });
    });
});

controller.webserver.get('/', (req, res) => {
    res.send(`This app is running Botkit ${ controller.version }.`);

});

controller.webserver.post('/', (req, res) => {
    res.send({
        challenge: req.body.challenge
    })
})

controller.webserver.get('/install', (req, res) => {
    // getInstallLink points to slack's oauth endpoint and includes clientId and scopes
    res.redirect(controller.adapter.getInstallLink());
});

controller.webserver.get('/install/auth', async (req, res) => {
    try {
        const results = await controller.adapter.validateOauthCode(req.query.code);

        console.log('FULL OAUTH DETAILS', results);

        // Store token by team in bot state.
        tokenCache[results.team_id] = results.bot.bot_access_token;

        // Capture team to bot id
        userCache[results.team_id] =  results.bot.bot_user_id;

        res.json('Success! Bot installed.');

    } catch (err) {
        console.error('OAUTH ERROR:', err);
        res.status(401);
        res.send(err.message);
    }
});

let tokenCache = {};
let userCache = {};

if (process.env.TOKENS) {
    tokenCache = JSON.parse(process.env.TOKENS);
} 

if (process.env.USERS) {
    userCache = JSON.parse(process.env.USERS);
} 

async function getTokenForTeam(teamId) {
    if (tokenCache[teamId]) {
        return new Promise((resolve) => {
            setTimeout(function() {
                resolve(tokenCache[teamId]);
            }, 150);
        });
    } else {
        console.error('Team not found in tokenCache: ', teamId);
    }
}

async function getBotUserByTeam(teamId) {
    if (userCache[teamId]) {
        return new Promise((resolve) => {
            setTimeout(function() {
                resolve(userCache[teamId]);
            }, 150);
        });
    } else {
        console.error('Team not found in userCache: ', teamId);
    }
}

