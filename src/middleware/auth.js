const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ethionutri_jwt_super_secret_key_2026_v1';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'ethionutri_jwt_refresh_secret_key_2026_v1';

function generateTokens(userPayload) {
  const accessToken = jwt.sign(
    { id: userPayload.id, email: userPayload.email, role: userPayload.role || 'user' },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );

  const refreshToken = jwt.sign(
    { id: userPayload.id },
    JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    // Demo fallback: default user payload if no bearer token passed
    req.user = { id: 'user-demo-1', email: 'demo@ethionutri.ai', role: 'user' };
    return next();
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired access token' });
    }
    req.user = decoded;
    next();
  });
}

module.exports = {
  generateTokens,
  authenticateToken,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
};
