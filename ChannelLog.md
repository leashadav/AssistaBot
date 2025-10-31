# Oct 31, 2025
Lots of updates, ok it doesn't seem like a lot but it really was a lot

### Current functions of the bot
- Birthday Module
  - users can add or delete their own
  - admins can add or delete anyones
~ - paginated embed of upcoming list~ currently broken (OOPS)
  - birth year is optional
  - gives birthday person the birthday role (or it's supposed to)
  - posts a happy birthday message (or it's supposed to)
- Ticket Module
  - opens a thread in the support channel, tags user in it and pushes it to the ticket log channel
  - closes thread and pushes it to the ticket log channel
- Invite Tracking
  - keeps track of invite codes and how many times it's been used
  - can use command to see who has an invite code and how many times it's been used
- Custom Slash Commands (/)
  - Assistabot info, info about the bot
  - Assistabot invite, link to invite bot to your own server
  - Assistabot say, admins can make the bot say things
  - Server, posts info about the server
  - User, posts info about a user/bot
~  - Stopbot, a command only I can use to kill the bot, works half of the time ~ removed it wasn't working anyways
  - Setup logchannel, set up what channels or threads you would like each log to go in to; Message Delete, Member Join, Member Leave, Ticket Created, Ticket Closed, General Log, Invite Log; it's supposed to be server specific but it seems I broke that and it's back to only posting in to the support server
- Logging System
  - Logs deleted messages but supposed to ignore bot messages
  - Logs when a member joins or leaves
  - Logs when a ticket is created and when a ticket is closed with a link to the thread for easier deleteing, still need to add a number system
  - General Logging mostly just logs when the bot goes online
- Custom Commands (!)
  - Global Commands that are available in every guild and in twitch chat
  - Server Specific commands, you can create a command with the same name as a global command to overwrite the command for your personal needs (should be available in twitch chat)
  - Cane use math, url fetch, random, user, touser, if no user provided default to everyone; user and touser does not tag the members so no annoying pings in discord
- Twitch Chat Bot
   - Can use the Custom Commands in chat
- New file start.js to run both the index.js and twitch.js at the same time
- a deploy-commands.js and a delete-commands.js to run to delete all slash commands and then deploy all slash commands, so when i keep moving things around can clean up any lingering mistakes
- a !reloadcom command to reload the custom commands without having to restart the bot

=====

# Sept 20, 2025
Rewrote bot and everything seems to be working without errors
Birthday module needs work, it did not post a happy birthday message

### Current functions of the bot
- Birthday Module
  - users can add or delete their own
  - admins can add or delete anyones
  - paginated embed of upcoming list
  - birth year is optional
  - gives birthday person the birthday role, or it's supposed to
  - posts a happy birthday message, or it's supposed to
- Ticket Module
  - opens a thread in the support channel, tags user in it and pushes it to the ticket log channel
  - closes thread and pushes it to the ticket log channel
- Invite Tracking
  - keeps track of invite codes and how many times it's been used
  - can use command to see who has an invite code and how many times it's been used
- Custom Slash Commands
  - Assistabot info, info about the bot
  - Assistabot invite, link to invite bot to your own server
  - Assistabot say, admins can make the bot say things
  - Server, posts info about the server
  - User, posts info about a user/bot
  - Stopbot, a command only I can use to kill the bot, works half of the time
- Logging System
  - Logs deleted messages but supposed to ignore bot messages
  - Logs when a member joins
  - Logs when a ticket is created and when a ticket is closed with a link to the thread for easier deleteing, still need to add a number system
  - General Logging mostly just logs when the bot goes online
