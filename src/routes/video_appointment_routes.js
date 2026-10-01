const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const { db } = require('../db');

const {
  appointments,
  nutritionists,
  users,
} = require('../db/schema');

const {
  eq,
  and,
} = require('drizzle-orm');

const {
  createVideoSession,
} = require('../services/video_appointment_service');


// ============================================================
// POST /api/v1/appointments/:id/video-session
// ============================================================
// Creates/returns the Jitsi room for a valid appointment.
//
// Only the nutritionist assigned to the appointment can request
// the video session.
// ============================================================

router.post(
  '/appointments/:id/video-session',
  authenticateToken,
  requireRole('nutritionist'),
  async (req, res) => {
    try {
      const appointmentId =
        req.params.id;

      if (
        !appointmentId ||
        !appointmentId.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: 'Appointment ID is required.',
        });
      }

      const nutritionistUserId =
        req.user.id;

      // --------------------------------------------------------
      // Find the logged-in nutritionist profile
      // --------------------------------------------------------

      const nutritionistResult =
        await db
          .select({
            id: nutritionists.id,
            userId: nutritionists.userId,
            isApproved:
              nutritionists.isApproved,
          })
          .from(nutritionists)
          .where(
            eq(
              nutritionists.userId,
              nutritionistUserId
            )
          )
          .limit(1);

      if (nutritionistResult.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            'Nutritionist profile not found.',
        });
      }

      const nutritionist =
        nutritionistResult[0];

      // --------------------------------------------------------
      // Require approved nutritionist
      // --------------------------------------------------------

      if (!nutritionist.isApproved) {
        return res.status(403).json({
          success: false,
          message:
            'Nutritionist account is not approved.',
        });
      }

      // --------------------------------------------------------
      // Find appointment belonging to this nutritionist
      // --------------------------------------------------------

      const appointmentResult =
        await db
          .select({
            id: appointments.id,

            userId:
              appointments.userId,

            nutritionistId:
              appointments.nutritionistId,

            scheduledAt:
              appointments.scheduledAt,

            status:
              appointments.status,

            notes:
              appointments.notes,

            userName:
              users.name,

            userEmail:
              users.email,
          })
          .from(appointments)
          .innerJoin(
            users,
            eq(
              appointments.userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                appointments.id,
                appointmentId
              ),
              eq(
                appointments.nutritionistId,
                nutritionist.id
              )
            )
          )
          .limit(1);

      // --------------------------------------------------------
      // Appointment does not exist or does not belong to
      // this nutritionist
      // --------------------------------------------------------

      if (appointmentResult.length === 0) {
        return res.status(404).json({
          success: false,
          message:
            'Appointment not found or not assigned to you.',
        });
      }

      const appointment =
        appointmentResult[0];

      // --------------------------------------------------------
      // Do not allow cancelled appointments
      // --------------------------------------------------------

      const status =
        appointment.status
          ?.toString()
          .toLowerCase();

      if (
        status === 'cancelled' ||
        status === 'canceled'
      ) {
        return res.status(409).json({
          success: false,
          message:
            'This appointment has been cancelled.',
        });
      }

      // --------------------------------------------------------
      // Generate deterministic Jitsi room
      // --------------------------------------------------------

      const session =
        createVideoSession(
          appointment.id
        );

      return res.status(200).json({
        success: true,

        appointmentId:
          appointment.id,

        domain:
          session.domain,

        roomName:
          session.roomName,

        scheduledAt:
          appointment.scheduledAt,

        status:
          appointment.status,

        patient: {
          id:
            appointment.userId,

          name:
            appointment.userName,

          email:
            appointment.userEmail,
        },
      });
    } catch (error) {
      console.error(
        '[VIDEO APPOINTMENT] Create session error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to create video consultation.',
      });
    }
  }
);
// ============================================================
// USER/PATIENT: CREATE VIDEO SESSION
// ============================================================
router.post(
  '/appointments/:id/video-session/patient',
  authenticateToken,
  requireRole('user'),
  async (req, res) => {
    try {
      const appointmentId = req.params.id;

      if (!appointmentId || !appointmentId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Appointment ID is required.',
        });
      }

      const userId = req.user.id;

      // Find the appointment and make sure it belongs to this user
      const appointmentResult = await db
        .select({
          id: appointments.id,
          userId: appointments.userId,
          nutritionistId: appointments.nutritionistId,
          scheduledAt: appointments.scheduledAt,
          status: appointments.status,
          notes: appointments.notes,

          nutritionistUserId: nutritionists.userId,
          nutritionistName: users.name,
          nutritionistEmail: users.email,
        })
        .from(appointments)
        .innerJoin(
          nutritionists,
          eq(appointments.nutritionistId, nutritionists.id)
        )
        .innerJoin(
          users,
          eq(nutritionists.userId, users.id)
        )
        .where(
          and(
            eq(appointments.id, appointmentId),
            eq(appointments.userId, userId)
          )
        )
        .limit(1);

      if (appointmentResult.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found or does not belong to you.',
        });
      }

      const appointment = appointmentResult[0];

      const status = appointment.status?.toString().toLowerCase();

      if (status === 'cancelled' || status === 'canceled') {
        return res.status(409).json({
          success: false,
          message: 'This appointment has been cancelled.',
        });
      }

      // Generate the same deterministic room as the nutritionist side
      const session = createVideoSession(appointment.id);

      return res.status(200).json({
        success: true,
        appointmentId: appointment.id,
        domain: session.domain,
        roomName: session.roomName,
        scheduledAt: appointment.scheduledAt,
        status: appointment.status,

        nutritionist: {
          id: appointment.nutritionistId,
          userId: appointment.nutritionistUserId,
          name: appointment.nutritionistName,
          email: appointment.nutritionistEmail,
        },
      });
    } catch (error) {
      console.error(
        '[VIDEO APPOINTMENT] Patient session error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Unable to create video consultation.',
      });
    }
  }
);

module.exports = router;