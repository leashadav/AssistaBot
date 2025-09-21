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
