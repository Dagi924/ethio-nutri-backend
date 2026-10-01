const crypto = require('crypto');

const JITSI_DOMAIN = 'meet.jit.si';

/**
 * Creates the same private-looking Jitsi room for the same
 * appointment every time.
 *
 * VIDEO_ROOM_SECRET should be placed in your .env file.
 *
 * Example:
 * VIDEO_ROOM_SECRET=your-long-random-secret
 */
function generateRoomName(appointmentId) {
  const secret =
    process.env.VIDEO_ROOM_SECRET ||
    'ethionutri-development-video-secret';

  const hash = crypto
    .createHmac('sha256', secret)
    .update(String(appointmentId))
    .digest('hex')
    .substring(0, 32);

  return `ethionutri-consult-${hash}`;
}

/**
 * Creates the video session information for an appointment.
 */
function createVideoSession(appointmentId) {
  if (!appointmentId) {
    throw new Error('Appointment ID is required.');
  }

  return {
    domain: JITSI_DOMAIN,
    roomName: generateRoomName(appointmentId),
  };
}

/**
 * Returns the Jitsi server domain.
 */
function getJitsiDomain() {
  return JITSI_DOMAIN;
}

module.exports = {
  generateRoomName,
  createVideoSession,
  getJitsiDomain,
};
