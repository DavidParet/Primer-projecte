'use strict';

const { createPilotAuthHandler } = require('../lib/pilot-auth-bff');
const { isFreeUsagePilot } = require('../lib/free-usage');

const handlePilotAuth = createPilotAuthHandler();

module.exports = function handler(req, res) {
  if (!isFreeUsagePilot()) return res.status(404).json({ state: 'not_found' });
  return handlePilotAuth(req, res);
};
