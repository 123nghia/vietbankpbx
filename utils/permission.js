/**
 * Permission & Authorization Utilities
 */

import logger from './logger.js';

/**
 * Check if user has admin role
 * @param {Object} req - Express request object
 * @param {Object} req.user - User object from auth middleware
 * @returns {boolean}
 */
export const isAdmin = (req) => {
  try {
    if (!req.user) {
      logger.warn('No user object in request');
      return false;
    }

    // Check multiple possible role fields for flexibility
    const role = req.user.role?.toLowerCase?.() || 
                 req.user.roleCode?.toLowerCase?.() || 
                 req.user.userRole?.toLowerCase?.() || 
                 '';

    return role === 'admin' || role === 'administrator' || role === 'super_admin';
  } catch (error) {
    logger.error('Error checking admin role:', error);
    return false;
  }
};

/**
 * Check if user has a specific role
 * @param {Object} req - Express request object
 * @param {string} requiredRole - Role to check for
 * @returns {boolean}
 */
export const hasRole = (req, requiredRole) => {
  try {
    if (!req.user) return false;

    const userRole = req.user.role?.toLowerCase?.() || 
                     req.user.roleCode?.toLowerCase?.() || 
                     '';

    return userRole === requiredRole.toLowerCase();
  } catch (error) {
    logger.error('Error checking user role:', error);
    return false;
  }
};

/**
 * Check if user is authenticated
 * @param {Object} req - Express request object
 * @returns {boolean}
 */
export const isAuthenticated = (req) => {
  return req.user && req.user.userId;
};

/**
 * Get current user ID from request
 * @param {Object} req - Express request object
 * @returns {string|null}
 */
export const getUserId = (req) => {
  try {
    return req.user?.userId || req.user?.id || null;
  } catch (error) {
    logger.error('Error getting user ID:', error);
    return null;
  }
};

/**
 * Admin authorization middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware
 */
export const adminAuthMiddleware = (req, res, next) => {
  if (!isAuthenticated(req)) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      statusCode: 401
    });
  }

  if (!isAdmin(req)) {
    return res.status(403).json({
      success: false,
      message: 'Admin access required',
      statusCode: 403
    });
  }

  next();
};

/**
 * Authentication middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware
 */
export const authMiddleware = (req, res, next) => {
  if (!isAuthenticated(req)) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required',
      statusCode: 401
    });
  }

  next();
};

export default {
  isAdmin,
  hasRole,
  isAuthenticated,
  getUserId,
  adminAuthMiddleware,
  authMiddleware
};
