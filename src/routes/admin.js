const express = require('express');
const router = express.Router();

const bcrypt = require('bcrypt');

const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const { db } = require('../db');

const {
  users,
  profiles,
  nutritionists,
  payments,
  foodLogs,
} = require('../db/schema');

const {
  eq,
  or,
} = require('drizzle-orm');


/*
|--------------------------------------------------------------------------
| POST /api/v1/admin/nutritionists
|--------------------------------------------------------------------------
| Admin creates a nutritionist account and nutritionist profile.
|
| Body:
| {
|   "name": "...",
|   "email": "...",
|   "password": "...",
|   "credentials": "...",
|   "bio": "...",
|   "hourlyRateEtb": 800
| }
|--------------------------------------------------------------------------
*/

router.post(
  '/nutritionists',
  authenticateToken,
  requireRole('admin'),
  async (req, res) => {
    try {
      const {
        name,
        email,
        password,
        credentials,
        bio,
        hourlyRateEtb,
        specializations,
      } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({
          error:
            'Name, email and password are required to create a nutritionist account',
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          error:
            'Nutritionist password must be at least 6 characters',
        });
      }

      const normalizedEmail =
        email.trim().toLowerCase();

      /*
       * Check if email already exists.
       */

      const existingUser =
        await db
          .select({
            id: users.id,
          })
          .from(users)
          .where(
            eq(users.email, normalizedEmail)
          )
          .limit(1);

      if (existingUser.length > 0) {
        return res.status(409).json({
          error:
            'A user with this email already exists',
        });
      }

      /*
       * Hash password using bcrypt.
       *
       * Result will look like:
       * $2b$12$...
       */

      const passwordHash =
        await bcrypt.hash(password, 12);

      /*
       * Create user.
       */

      const createdUsers =
        await db
          .insert(users)
          .values({
            name: name.trim(),
            email: normalizedEmail,
            passwordHash,
            role: 'nutritionist',
            isPremium: true,
            paymentStatus: 'active_premium',
          })
          .returning();

      const newUser = createdUsers[0];

      try {
        /*
         * Create nutritionist profile.
         */

        const createdNutritionists =
          await db
            .insert(nutritionists)
            .values({
              userId: newUser.id,

              credentials:
                credentials ||
                'MSc Clinical Nutrition, Certified Dietitian',

              bio:
                bio ||
                'Expert in Ethiopian traditional dietary health.',

              specializations:
                Array.isArray(
                  specializations
                )
                  ? specializations
                  : [
                      'Heritage Fasting Nutrition',
                      'Diabetes Management',
                    ],

              hourlyRateEtb:
                hourlyRateEtb !== undefined
                  ? Number(hourlyRateEtb)
                  : 800,

              isApproved: true,
            })
            .returning();

        const nutritionist =
          createdNutritionists[0];

        return res.status(201).json({
          message:
            'Nutritionist account created and supervision access granted by Admin',

          user: {
            id: newUser.id,
            email: newUser.email,
            name: newUser.name,
            role: newUser.role,
            isPremium:
              newUser.isPremium,
          },

          nutritionist,
        });
      } catch (nutritionistError) {
        /*
         * If nutritionist profile creation fails,
         * remove the user we just created.
         */

        await db
          .delete(users)
          .where(eq(users.id, newUser.id));

        throw nutritionistError;
      }
    } catch (error) {
      console.error(
        '[ADMIN] Create nutritionist error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to create nutritionist account',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET /api/v1/admin/users
|--------------------------------------------------------------------------
| List all users.
|--------------------------------------------------------------------------
*/

router.get(
  '/users',
  authenticateToken,
  requireRole('admin'),
  async (req, res) => {
    try {
      const allUsers =
        await db
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            phone: users.phone,
            role: users.role,
            isPremium:
              users.isPremium,
            paymentStatus:
              users.paymentStatus,
            createdAt:
              users.createdAt,
            updatedAt:
              users.updatedAt,
          })
          .from(users);

      return res.json({
        totalUsers: allUsers.length,
        users: allUsers,
      });
    } catch (error) {
      console.error(
        '[ADMIN] Get users error:',
        error
      );

      return res.status(500).json({
        error: 'Failed to load users',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| DELETE /api/v1/admin/users/:id
|--------------------------------------------------------------------------
| Delete user.
|
| Profiles, food logs, appointments, etc. that reference the
| user with ON DELETE CASCADE will be removed automatically.
|--------------------------------------------------------------------------
*/

router.delete(
  '/users/:id',
  authenticateToken,
  requireRole('admin'),
  async (req, res) => {
    try {
      const targetId = req.params.id;

      /*
       * Prevent admin from accidentally deleting
       * their own account.
       */

      if (targetId === req.user.id) {
        return res.status(400).json({
          error:
            'You cannot delete your own admin account',
        });
      }

      const existing =
        await db
          .select({
            id: users.id,
            role: users.role,
          })
          .from(users)
          .where(eq(users.id, targetId))
          .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({
          error: 'User not found',
        });
      }

      await db
        .delete(users)
        .where(eq(users.id, targetId));

      return res.json({
        message:
          'User account deleted by Admin',
        deletedId: targetId,
      });
    } catch (error) {
      console.error(
        '[ADMIN] Delete user error:',
        error
      );

      return res.status(500).json({
        error: 'Failed to delete user',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| DELETE /api/v1/admin/nutritionists/:id
|--------------------------------------------------------------------------
|
| :id can be either:
|
| - nutritionists.id
| - users.id
|
| This makes the endpoint easier for the Flutter admin dashboard.
|--------------------------------------------------------------------------
*/

router.delete(
  '/nutritionists/:id',
  authenticateToken,
  requireRole('admin'),
  async (req, res) => {
    try {
      const targetId = req.params.id;

      /*
       * Find nutritionist using either nutritionist ID
       * or associated user ID.
       */

      const found =
        await db
          .select({
            nutritionistId:
              nutritionists.id,
            userId:
              nutritionists.userId,
          })
          .from(nutritionists)
          .where(
            or(
              eq(
                nutritionists.id,
                targetId
              ),
              eq(
                nutritionists.userId,
                targetId
              )
            )
          )
          .limit(1);

      if (found.length === 0) {
        return res.status(404).json({
          error:
            'Nutritionist not found',
        });
      }

      const nutritionist =
        found[0];

      /*
       * Because nutritionists.userId references users.id
       * with ON DELETE CASCADE, deleting the user also
       * deletes the nutritionist profile.
       */

      await db
        .delete(users)
        .where(
          eq(
            users.id,
            nutritionist.userId
          )
        );

      return res.json({
        message:
          'Nutritionist account removed by Admin',

        deletedId:
          nutritionist.nutritionistId,

        deletedUserId:
          nutritionist.userId,
      });
    } catch (error) {
      console.error(
        '[ADMIN] Delete nutritionist error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to delete nutritionist',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET /api/v1/admin/analytics
|--------------------------------------------------------------------------
| System-wide metrics.
|--------------------------------------------------------------------------
*/

router.get(
  '/analytics',
  authenticateToken,
  requireRole('admin'),
  async (req, res) => {
    try {
      /*
       * Users
       */

      const allUsers =
        await db
          .select({
            id: users.id,
            isPremium:
              users.isPremium,
            paymentStatus:
              users.paymentStatus,
          })
          .from(users);

      /*
       * Nutritionists
       */

      const allNutritionists =
        await db
          .select({
            id: nutritionists.id,
          })
          .from(nutritionists);

      /*
       * Payments
       */

      const allPayments =
        await db
          .select({
            amountEtb:
              payments.amountEtb,
            status:
              payments.status,
          })
          .from(payments);

      /*
       * Food logs
       */

      const allFoodLogs =
        await db
          .select({
            id: foodLogs.id,
          })
          .from(foodLogs);

      /*
       * Calculate premium users.
       */

      const activePremiumUsers =
        allUsers.filter(
          (user) =>
            user.isPremium === true ||
            user.paymentStatus ===
              'active_premium'
        ).length;

      /*
       * Calculate successful revenue.
       *
       * Only successful payments are counted.
       */

      const paymentRevenue =
        allPayments
          .filter(
            (payment) =>
              payment.status ===
              'success'
          )
          .reduce(
            (total, payment) =>
              total +
              Number(
                payment.amountEtb || 0
              ),
            0
          );

      /*
       * Existing premium users can also represent
       * the 299 ETB subscription if they don't have
       * a corresponding payment record.
       *
       * Keep this compatible with your previous logic.
       */

      const premiumSubscriptionRevenue =
        allUsers.filter(
          (user) =>
            user.isPremium === true
        ).length * 299;

      const totalRevenueEtb =
        paymentRevenue +
        premiumSubscriptionRevenue;

      return res.json({
        systemOverview: {
          totalRegisteredUsers:
            allUsers.length,

          activePremiumUsers,

          activeDietitians:
            allNutritionists.length,

          totalRevenueEtb,

          totalFoodLogs:
            allFoodLogs.length,
        },
      });
    } catch (error) {
      console.error(
        '[ADMIN] Analytics error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to load system analytics',
      });
    }
  }
);
router.get(
  '/nutritionists',
  authenticateToken,
  requireRole('admin'),
  async (req, res) => {
    try {
      const result = await db
        .select({
          nutritionistId: nutritionists.id,
          userId: nutritionists.userId,
          name: users.name,
          email: users.email,
          credentials: nutritionists.credentials,
          bio: nutritionists.bio,
          specializations: nutritionists.specializations,
          hourlyRateEtb: nutritionists.hourlyRateEtb,
          isApproved: nutritionists.isApproved,
        })
        .from(nutritionists)
        .innerJoin(
          users,
          eq(nutritionists.userId, users.id)
        );

      return res.json({
        totalNutritionists: result.length,
        nutritionists: result,
      });
    } catch (error) {
      console.error(
        '[ADMIN] Get nutritionists error:',
        error
      );

      return res.status(500).json({
        error: 'Failed to load nutritionists',
      });
    }
  }
);

module.exports = router;