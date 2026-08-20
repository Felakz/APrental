module.exports = {
  port: parseInt(process.env.PORT, 10) || 4000,
  parentPassword: process.env.PARENT_PASSWORD || 'IRZ6nCHU2bEGT9F8K5k1jDyv',
  agentKey: process.env.AGENT_KEY || 'xiqjtUg1F39TlvYdVRDA8SzCMQELo5nh',
  serverUrl: process.env.SERVER_URL || 'ws://localhost:4000'
};
