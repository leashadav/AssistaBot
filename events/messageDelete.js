const { logDelete } = require('../modules/logger');

module.exports = {
  name: 'messageDelete',
  async execute(message, client) {
    logDelete(message, client);
  },
};