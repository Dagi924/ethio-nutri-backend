const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

const { db } = require('../db');

const {
  users,
  profiles,
  nutritionists,
  appointments,
  supervisionMessages,
} = require('../db/schema');

const {
  eq,
  and,
  desc,
  asc,
} = require('drizzle-orm');


/*
|--------------------------------------------------------------------------
| APPOINTMENT CONFIGURATION
|--------------------------------------------------------------------------
*/

const ETHIOPIA_TIMEZONE = 'Africa/Addis_Ababa';
const ETHIOPIA_OFFSET = '+03:00';

const WORK_START_MINUTES = 8 * 60;   // 08:00
const WORK_END_MINUTES = 17 * 60;     // 17:00

const APPOINTMENT_DURATION_MINUTES = 30;


/*
|--------------------------------------------------------------------------
| TIMEZONE HELPERS
|--------------------------------------------------------------------------
| All appointment scheduling is handled in Ethiopia time.
|--------------------------------------------------------------------------
*/


function getEthiopiaParts(date) {
  const formatter = new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: ETHIOPIA_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }
  );

  const parts = formatter.formatToParts(date);

  const values = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}


function getEthiopiaDateString(date) {
  const parts = getEthiopiaParts(date);

  return [
    parts.year.toString().padStart(4, '0'),
    parts.month.toString().padStart(2, '0'),
    parts.day.toString().padStart(2, '0'),
  ].join('-');
}


function getMinutesInEthiopia(date) {
  const parts = getEthiopiaParts(date);

  return (
    parts.hour * 60 +
    parts.minute
  );
}


/*
|--------------------------------------------------------------------------
| VALIDATE YYYY-MM-DD
|--------------------------------------------------------------------------
*/

function isValidEthiopiaDateString(date) {
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return false;
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const testDate = new Date(
    Date.UTC(
      year,
      month - 1,
      day
    )
  );

  return (
    testDate.getUTCFullYear() === year &&
    testDate.getUTCMonth() === month - 1 &&
    testDate.getUTCDate() === day
  );
}


/*
|--------------------------------------------------------------------------
| PARSE ETHIOPIA LOCAL DATE/TIME
|--------------------------------------------------------------------------
|
| If Flutter sends:
|
| 2026-10-01T09:00:00
|
| we explicitly interpret it as:
|
| 2026-10-01 09:00 Ethiopia time (+03:00)
|
| This prevents the backend server timezone from changing the appointment.
|--------------------------------------------------------------------------
*/

function parseScheduledAt(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getTime());
  }

  const stringValue =
    String(value).trim();

  if (!stringValue) {
    return null;
  }

  /*
   * If the value already contains
   * timezone information, respect it.
   *
   * Examples:
   *
   * 2026-10-01T09:00:00Z
   * 2026-10-01T09:00:00+03:00
   */

  const hasTimezone =
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(
      stringValue
    );

  if (hasTimezone) {
    const parsed =
      new Date(stringValue);

    return Number.isNaN(
      parsed.getTime()
    )
      ? null
      : parsed;
  }

  /*
   * Otherwise interpret the value
   * as Ethiopia local time.
   *
   * Expected:
   *
   * YYYY-MM-DDTHH:mm
   * YYYY-MM-DDTHH:mm:ss
   */

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
      .exec(stringValue);

  if (!match) {
    return null;
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  const hour =
    Number(match[4]);

  const minute =
    Number(match[5]);

  const second =
    Number(match[6] || 0);

  /*
   * Validate calendar/time values.
   */

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  const dateString =
    [
      year.toString().padStart(4, '0'),
      month.toString().padStart(2, '0'),
      day.toString().padStart(2, '0'),
    ].join('-');

  if (
    !isValidEthiopiaDateString(
      dateString
    )
  ) {
    return null;
  }

  const timeString =
    [
      hour.toString().padStart(2, '0'),
      minute.toString().padStart(2, '0'),
      second.toString().padStart(2, '0'),
    ].join(':');

  const parsed =
    new Date(
      `${dateString}T${timeString}${ETHIOPIA_OFFSET}`
    );

  return Number.isNaN(
    parsed.getTime()
  )
    ? null
    : parsed;
}


/*
|--------------------------------------------------------------------------
| CREATE AN ETHIOPIA SLOT DATE
|--------------------------------------------------------------------------
*/

function createEthiopiaSlotDate(
  date,
  minutes
) {
  const hour =
    Math.floor(minutes / 60);

  const minute =
    minutes % 60;

  const time =
    `${hour.toString().padStart(2, '0')}:${minute
      .toString()
      .padStart(2, '0')}:00`;

  return new Date(
    `${date}T${time}${ETHIOPIA_OFFSET}`
  );
}


/*
|--------------------------------------------------------------------------
| NORMALIZE APPOINTMENT STATUS
|--------------------------------------------------------------------------
*/

function isCancelledStatus(status) {
  const normalized =
    status
      ?.toString()
      .trim()
      .toLowerCase();

  return (
    normalized === 'cancelled' ||
    normalized === 'canceled'
  );
}


/*
|--------------------------------------------------------------------------
| GET /api/v1/supervision/nutritionist/:id
|--------------------------------------------------------------------------
| Get a nutritionist profile.
|
| :id = nutritionists.id
|--------------------------------------------------------------------------
*/

router.get(
  '/nutritionist/:id',
  authenticateToken,
  async (req, res) => {
    try {
      const nutritionistId =
        req.params.id;

      const result =
        await db
          .select({
            id:
              nutritionists.id,

            userId:
              nutritionists.userId,

            name:
              users.name,

            email:
              users.email,

            role:
              users.role,

            credentials:
              nutritionists.credentials,

            bio:
              nutritionists.bio,

            specializations:
              nutritionists.specializations,

            hourlyRateEtb:
              nutritionists.hourlyRateEtb,

            isApproved:
              nutritionists.isApproved,
          })
          .from(nutritionists)
          .innerJoin(
            users,
            eq(
              nutritionists.userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                nutritionists.id,
                nutritionistId
              ),
              eq(
                users.role,
                'nutritionist'
              )
            )
          )
          .limit(1);

      if (result.length === 0) {
        return res.status(404).json({
          error:
            'Nutritionist not found',
        });
      }

      return res.json({
        nutritionist: {
          ...result[0],

          availableSlots: [
            '09:00 AM',
            '11:30 AM',
            '02:00 PM',
            '04:30 PM',
          ],
        },
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Get nutritionist error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to load nutritionist',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET /api/v1/supervision/nutritionists
|--------------------------------------------------------------------------
| Get all approved nutritionists for patients.
|
| users.role identifies the account as a nutritionist.
| nutritionists.id is the ID used by appointments.
|--------------------------------------------------------------------------
*/

router.get(
  '/nutritionists',
  authenticateToken,
  requireRole('user'),
  async (req, res) => {
    try {
      const rows =
        await db
          .select({
            id:
              nutritionists.id,

            userId:
              nutritionists.userId,

            name:
              users.name,

            email:
              users.email,

            role:
              users.role,

            bio:
              nutritionists.bio,

            specializations:
              nutritionists.specializations,

            credentials:
              nutritionists.credentials,

            hourlyRateEtb:
              nutritionists.hourlyRateEtb,

            isApproved:
              nutritionists.isApproved,
          })
          .from(nutritionists)
          .innerJoin(
            users,
            eq(
              nutritionists.userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                nutritionists.isApproved,
                true
              ),
              eq(
                users.role,
                'nutritionist'
              )
            )
          )
          .orderBy(
            asc(users.name)
          );

      return res.status(200).json({
        success: true,
        nutritionists: rows,
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Get nutritionists error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load nutritionists.',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET /api/v1/supervision/nutritionists/:id/availability
|--------------------------------------------------------------------------
| Get available 30-minute appointment slots.
|
| Working hours:
| 08:00 - 17:00 Ethiopia time
|
| Slots:
| 08:00
| 08:30
| 09:00
| ...
| 16:30
|--------------------------------------------------------------------------
*/

router.get(
  '/nutritionists/:id/availability',
  authenticateToken,
  requireRole('user'),
  async (req, res) => {
    try {
      const nutritionistId =
        req.params.id;

      const date =
        req.query.date?.toString();

      if (
        !nutritionistId ||
        !nutritionistId.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Nutritionist ID is required.',
        });
      }

      if (!date) {
        return res.status(400).json({
          success: false,
          message:
            'Date is required. Use YYYY-MM-DD.',
        });
      }

      /*
       * Validate date.
       */

      if (
        !isValidEthiopiaDateString(
          date
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid date. Use YYYY-MM-DD.',
        });
      }

      /*
       * Find nutritionist through BOTH tables.
       *
       * nutritionists.id = appointment FK
       * nutritionists.userId = users.id
       * users.role = nutritionist
       */

      const nutritionistResult =
        await db
          .select({
            id:
              nutritionists.id,

            userId:
              nutritionists.userId,

            name:
              users.name,

            email:
              users.email,

            role:
              users.role,

            isApproved:
              nutritionists.isApproved,
          })
          .from(nutritionists)
          .innerJoin(
            users,
            eq(
              nutritionists.userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                nutritionists.id,
                nutritionistId
              ),
              eq(
                users.role,
                'nutritionist'
              )
            )
          )
          .limit(1);

      if (
        nutritionistResult.length ===
        0
      ) {
        return res.status(404).json({
          success: false,
          message:
            'Nutritionist not found.',
        });
      }

      const nutritionist =
        nutritionistResult[0];

      if (
        !nutritionist.isApproved
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Nutritionist is not approved.',
        });
      }

      /*
       * Determine today in Ethiopia.
       */

      const now =
        new Date();

      const todayEthiopia =
        getEthiopiaDateString(
          now
        );

      /*
       * A past date can never have
       * available appointments.
       */

      if (
        date <
        todayEthiopia
      ) {
        return res.status(200).json({
          success: true,

          nutritionistId,

          nutritionist: {
            id:
              nutritionist.id,

            userId:
              nutritionist.userId,

            name:
              nutritionist.name,

            email:
              nutritionist.email,
          },

          date,

          timezone:
            ETHIOPIA_TIMEZONE,

          durationMinutes:
            APPOINTMENT_DURATION_MINUTES,

          availableFrom:
            '08:00',

          availableUntil:
            '17:00',

          availableSlots: [],
        });
      }

      /*
       * Get appointments for this
       * nutritionist.
       */

      const existingAppointments =
        await db
          .select({
            id:
              appointments.id,

            scheduledAt:
              appointments.scheduledAt,

            status:
              appointments.status,
          })
          .from(appointments)
          .where(
            eq(
              appointments.nutritionistId,
              nutritionistId
            )
          )
          .orderBy(
            asc(
              appointments.scheduledAt
            )
          );

      const currentMinutesEthiopia =
        getMinutesInEthiopia(
          now
        );

      const availableSlots = [];

      /*
       * Generate:
       *
       * 08:00
       * 08:30
       * ...
       * 16:30
       */

      for (
        let minutes =
          WORK_START_MINUTES;

        minutes <
          WORK_END_MINUTES;

        minutes +=
          APPOINTMENT_DURATION_MINUTES
      ) {
        /*
         * If selected date is today,
         * don't show past slots.
         */

        if (
          date ===
            todayEthiopia &&
          minutes <=
            currentMinutesEthiopia
        ) {
          continue;
        }

        /*
         * Check whether another
         * appointment occupies this slot.
         */

        const isTaken =
          existingAppointments.some(
            (appointment) => {
              if (
                isCancelledStatus(
                  appointment.status
                )
              ) {
                return false;
              }

              if (
                !appointment.scheduledAt
              ) {
                return false;
              }

              const existingStart =
                parseScheduledAt(
                  appointment.scheduledAt
                );

              if (!existingStart) {
                return false;
              }

              /*
               * Convert appointment
               * to Ethiopia time.
               */

              const existingParts =
                getEthiopiaParts(
                  existingStart
                );

              const existingDate =
                [
                  existingParts.year
                    .toString()
                    .padStart(4, '0'),

                  existingParts.month
                    .toString()
                    .padStart(2, '0'),

                  existingParts.day
                    .toString()
                    .padStart(2, '0'),
                ].join('-');

              /*
               * Different date does not
               * block this slot.
               */

              if (
                existingDate !==
                date
              ) {
                return false;
              }

              const existingStartMinutes =
                existingParts.hour *
                  60 +
                existingParts.minute;

              const existingEndMinutes =
                existingStartMinutes +
                APPOINTMENT_DURATION_MINUTES;

              const slotStart =
                minutes;

              const slotEnd =
                minutes +
                APPOINTMENT_DURATION_MINUTES;

              /*
               * Standard interval overlap.
               */

              return (
                slotStart <
                  existingEndMinutes &&
                slotEnd >
                  existingStartMinutes
              );
            }
          );

        if (!isTaken) {
          const hour =
            Math.floor(
              minutes / 60
            );

          const minute =
            minutes % 60;

          availableSlots.push(
            `${hour
              .toString()
              .padStart(2, '0')}:${minute
              .toString()
              .padStart(2, '0')}`
          );
        }
      }

      return res.status(200).json({
        success: true,

        nutritionistId,

        nutritionist: {
          id:
            nutritionist.id,

          userId:
            nutritionist.userId,

          name:
            nutritionist.name,

          email:
            nutritionist.email,
        },

        date,

        timezone:
          ETHIOPIA_TIMEZONE,

        durationMinutes:
          APPOINTMENT_DURATION_MINUTES,

        availableFrom:
          '08:00',

        availableUntil:
          '17:00',

        availableSlots,
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Get availability error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to load available times.',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| POST /api/v1/supervision/appointments
|--------------------------------------------------------------------------
| Create appointment for authenticated patient.
|
| nutritionistId MUST be nutritionists.id.
|--------------------------------------------------------------------------
*/

router.post(
  '/appointments',
  authenticateToken,
  requireRole('user'),
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const {
        nutritionistId,
        scheduledAt,
        notes,
      } = req.body;

      /*
       * Validate required fields.
       */

      if (!nutritionistId) {
        return res.status(400).json({
          error:
            'nutritionistId is required',
        });
      }

      if (!scheduledAt) {
        return res.status(400).json({
          error:
            'scheduledAt is required',
        });
      }

      /*
       * Parse appointment.
       *
       * Values without timezone are
       * interpreted as Ethiopia time.
       */

      const appointmentDate =
        parseScheduledAt(
          scheduledAt
        );

      if (!appointmentDate) {
        return res.status(400).json({
          error:
            'Invalid scheduledAt date',
        });
      }

      /*
       * Don't allow appointments
       * in the past.
       */

      if (
        appointmentDate <=
        new Date()
      ) {
        return res.status(400).json({
          error:
            'Appointment must be scheduled for a future time',
        });
      }

      /*
       * Find nutritionist through BOTH
       * tables.
       */

      const nutritionist =
        await db
          .select({
            id:
              nutritionists.id,

            userId:
              nutritionists.userId,

            role:
              users.role,

            isApproved:
              nutritionists.isApproved,
          })
          .from(nutritionists)
          .innerJoin(
            users,
            eq(
              nutritionists.userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                nutritionists.id,
                nutritionistId
              ),
              eq(
                users.role,
                'nutritionist'
              )
            )
          )
          .limit(1);

      if (
        nutritionist.length === 0
      ) {
        return res.status(404).json({
          error:
            'Nutritionist not found',
        });
      }

      /*
       * Only approved nutritionists
       * can receive appointments.
       */

      if (
        !nutritionist[0]
          .isApproved
      ) {
        return res.status(403).json({
          error:
            'This nutritionist is not currently approved',
        });
      }

      /*
       * Get appointment time in
       * Ethiopia.
       */

      const appointmentParts =
        getEthiopiaParts(
          appointmentDate
        );

      const appointmentDateString =
        [
          appointmentParts.year
            .toString()
            .padStart(4, '0'),

          appointmentParts.month
            .toString()
            .padStart(2, '0'),

          appointmentParts.day
            .toString()
            .padStart(2, '0'),
        ].join('-');

      const appointmentMinutes =
        appointmentParts.hour *
          60 +
        appointmentParts.minute;

      /*
       * Appointment must start on:
       *
       * 08:00
       * 08:30
       * 09:00
       * ...
       * 16:30
       */

      if (
        appointmentMinutes <
          WORK_START_MINUTES ||
        appointmentMinutes >=
          WORK_END_MINUTES ||
        appointmentParts.minute %
          APPOINTMENT_DURATION_MINUTES !==
          0 ||
        appointmentParts.second !==
          0
      ) {
        return res.status(400).json({
          error:
            'Appointments must start on a 30-minute slot between 08:00 and 16:30 Ethiopia time.',
        });
      }

      /*
       * Make sure the selected
       * Ethiopia date is valid.
       */

      if (
        !isValidEthiopiaDateString(
          appointmentDateString
        )
      ) {
        return res.status(400).json({
          error:
            'Invalid appointment date.',
        });
      }

      /*
       * Appointment duration =
       * 30 minutes.
       */

      const appointmentEnd =
        new Date(
          appointmentDate.getTime() +
            APPOINTMENT_DURATION_MINUTES *
              60 *
              1000
        );

      /*
       * Get existing appointments
       * for this nutritionist.
       */

      const existingAppointments =
        await db
          .select({
            id:
              appointments.id,

            scheduledAt:
              appointments.scheduledAt,

            status:
              appointments.status,
          })
          .from(appointments)
          .where(
            eq(
              appointments.nutritionistId,
              nutritionistId
            )
          );

      /*
       * Check overlap.
       */

      const conflictingAppointment =
        existingAppointments.find(
          (existing) => {
            if (
              isCancelledStatus(
                existing.status
              )
            ) {
              return false;
            }

            if (
              !existing.scheduledAt
            ) {
              return false;
            }

            const existingStart =
              parseScheduledAt(
                existing.scheduledAt
              );

            if (!existingStart) {
              return false;
            }

            const existingEnd =
              new Date(
                existingStart.getTime() +
                  APPOINTMENT_DURATION_MINUTES *
                    60 *
                    1000
              );

            return (
              appointmentDate <
                existingEnd &&
              appointmentEnd >
                existingStart
            );
          }
        );

      if (
        conflictingAppointment
      ) {
        return res.status(409).json({
          error:
            'This time slot is already booked. Please choose another time.',
        });
      }

      /*
       * Insert appointment.
       */

      const inserted =
        await db
          .insert(appointments)
          .values({
            userId,

            nutritionistId,

            scheduledAt:
              appointmentDate,

            status:
              'confirmed',

            notes:
              notes ||
              'Fasting nutrition optimization & iron target review',
          })
          .returning();

      return res.status(201).json({
        message:
          'Consultation appointment booked successfully',

        appointment:
          inserted[0],
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Create appointment error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to create appointment',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET /api/v1/supervision/my-appointments
|--------------------------------------------------------------------------
| Get appointments belonging to authenticated patient.
|--------------------------------------------------------------------------
*/

router.get(
  '/my-appointments',
  authenticateToken,
  requireRole('user'),
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const rows =
        await db
          .select({
            id:
              appointments.id,

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

            createdAt:
              appointments.createdAt,

            nutritionistName:
              users.name,

            nutritionistEmail:
              users.email,

            credentials:
              nutritionists.credentials,

            bio:
              nutritionists.bio,

            specializations:
              nutritionists.specializations,

            hourlyRateEtb:
              nutritionists.hourlyRateEtb,
          })
          .from(appointments)
          .innerJoin(
            nutritionists,
            eq(
              appointments.nutritionistId,
              nutritionists.id
            )
          )
          .innerJoin(
            users,
            eq(
              nutritionists.userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                appointments.userId,
                userId
              ),
              eq(
                users.role,
                'nutritionist'
              )
            )
          )
          .orderBy(
            asc(
              appointments.scheduledAt
            )
          );

      return res.json({
        success: true,
        appointments: rows,
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] My appointments error:',
        error
      );

      return res.status(500).json({
        success: false,
        error:
          'Failed to load appointments',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| POST /api/v1/supervision/consent
|--------------------------------------------------------------------------
*/

router.post(
  '/consent',
  authenticateToken,
  requireRole('user'),
  async (req, res) => {
    try {
      const {
        shareTelemetry,
        shareFastingCompliance,
        shareDeficiencyAlerts,
      } = req.body;

      return res.json({
        message:
          'Data privacy & clinical supervision consent preferences received',

        consent: {
          shareTelemetry:
            shareTelemetry !==
            undefined
              ? Boolean(
                  shareTelemetry
                )
              : true,

          shareFastingCompliance:
            shareFastingCompliance !==
            undefined
              ? Boolean(
                  shareFastingCompliance
                )
              : true,

          shareDeficiencyAlerts:
            shareDeficiencyAlerts !==
            undefined
              ? Boolean(
                  shareDeficiencyAlerts
                )
              : true,
        },

        persisted: false,

        note:
          'Consent is not persisted because there is no consent table in the current database schema.',
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Consent error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to save consent preferences',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET /api/v1/supervision/chat/history
|--------------------------------------------------------------------------
*/

router.get(
  '/chat/history',
  authenticateToken,
  requireRole('user'),
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const messages =
        await db
          .select({
            id:
              supervisionMessages.id,

            userId:
              supervisionMessages.userId,

            nutritionistId:
              supervisionMessages
                .nutritionistId,

            senderRole:
              supervisionMessages
                .senderRole,

            message:
              supervisionMessages.message,

            mediaUrl:
              supervisionMessages.mediaUrl,

            sentAt:
              supervisionMessages.sentAt,
          })
          .from(
            supervisionMessages
          )
          .where(
            eq(
              supervisionMessages.userId,
              userId
            )
          )
          .orderBy(
            asc(
              supervisionMessages.sentAt
            )
          );

      return res.json({
        messages,
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Chat history error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to load chat history',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| POST /api/v1/supervision/chat/send
|--------------------------------------------------------------------------
*/

router.post(
  '/chat/send',
  authenticateToken,
  async (req, res) => {
    try {
      const senderId =
        req.user.id;

      const senderRole =
        req.user.role ||
        'user';

      const {
        userId,
        nutritionistId,
        message,
        mediaUrl,
      } = req.body;

      if (
        !message ||
        typeof message !==
          'string' ||
        message.trim()
          .length === 0
      ) {
        return res.status(400).json({
          error:
            'Message is required',
        });
      }

      if (
        message.trim()
          .length > 5000
      ) {
        return res.status(400).json({
          error:
            'Message cannot exceed 5000 characters',
        });
      }

      let patientId;
      let targetNutritionistId;

      /*
       * PATIENT SENDING
       */

      if (
        senderRole === 'user'
      ) {
        patientId =
          senderId;

        targetNutritionistId =
          nutritionistId;

        if (
          !targetNutritionistId
        ) {
          return res.status(400).json({
            error:
              'nutritionistId is required',
          });
        }

        const nutritionist =
          await db
            .select({
              id:
                nutritionists.id,

              isApproved:
                nutritionists
                  .isApproved,

              role:
                users.role,
            })
            .from(
              nutritionists
            )
            .innerJoin(
              users,
              eq(
                nutritionists.userId,
                users.id
              )
            )
            .where(
              and(
                eq(
                  nutritionists.id,
                  targetNutritionistId
                ),
                eq(
                  users.role,
                  'nutritionist'
                )
              )
            )
            .limit(1);

        if (
          nutritionist.length ===
          0
        ) {
          return res.status(404).json({
            error:
              'Nutritionist not found',
          });
        }

        if (
          !nutritionist[0]
            .isApproved
        ) {
          return res.status(403).json({
            error:
              'This nutritionist is not currently approved',
          });
        }
      }

      /*
       * NUTRITIONIST SENDING
       */

      else if (
        senderRole ===
        'nutritionist'
      ) {
        patientId =
          userId;

        if (!patientId) {
          return res.status(400).json({
            error:
              'userId is required when a nutritionist sends a message',
          });
        }

        const nutritionist =
          await db
            .select({
              id:
                nutritionists.id,

              isApproved:
                nutritionists
                  .isApproved,

              role:
                users.role,
            })
            .from(
              nutritionists
            )
            .innerJoin(
              users,
              eq(
                nutritionists.userId,
                users.id
              )
            )
            .where(
              and(
                eq(
                  nutritionists.userId,
                  senderId
                ),
                eq(
                  users.role,
                  'nutritionist'
                )
              )
            )
            .limit(1);

        if (
          nutritionist.length ===
          0
        ) {
          return res.status(404).json({
            error:
              'Nutritionist profile not found',
          });
        }

        if (
          !nutritionist[0]
            .isApproved
        ) {
          return res.status(403).json({
            error:
              'Nutritionist account is not approved',
          });
        }

        targetNutritionistId =
          nutritionist[0].id;

        const patient =
          await db
            .select({
              id:
                users.id,

              role:
                users.role,
            })
            .from(users)
            .where(
              eq(
                users.id,
                patientId
              )
            )
            .limit(1);

        if (
          patient.length ===
          0
        ) {
          return res.status(404).json({
            error:
              'Patient not found',
          });
        }

        if (
          patient[0].role !==
          'user'
        ) {
          return res.status(400).json({
            error:
              'Selected account is not a patient',
          });
        }
      }

      else {
        return res.status(403).json({
          error:
            'Unauthorized chat role',
        });
      }

      /*
       * SAVE MESSAGE
       */

      const created =
        await db
          .insert(
            supervisionMessages
          )
          .values({
            userId:
              patientId,

            nutritionistId:
              targetNutritionistId,

            senderRole:
              senderRole ===
              'nutritionist'
                ? 'nutritionist'
                : 'user',

            message:
              message.trim(),

            mediaUrl:
              mediaUrl ||
              null,
          })
          .returning();

      return res.status(201).json({
        message:
          created[0],
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Send chat error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to send message',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET /api/v1/supervision/messages/:nutritionistId
|--------------------------------------------------------------------------
*/

router.get(
  '/messages/:nutritionistId',
  authenticateToken,
  requireRole('user'),
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const nutritionistId =
        req.params
          .nutritionistId;

      const messages =
        await db
          .select({
            id:
              supervisionMessages.id,

            userId:
              supervisionMessages.userId,

            nutritionistId:
              supervisionMessages
                .nutritionistId,

            senderRole:
              supervisionMessages
                .senderRole,

            message:
              supervisionMessages
                .message,

            mediaUrl:
              supervisionMessages
                .mediaUrl,

            sentAt:
              supervisionMessages
                .sentAt,
          })
          .from(
            supervisionMessages
          )
          .where(
            and(
              eq(
                supervisionMessages
                  .userId,
                userId
              ),

              eq(
                supervisionMessages
                  .nutritionistId,
                nutritionistId
              )
            )
          )
          .orderBy(
            asc(
              supervisionMessages
                .sentAt
            )
          );

      return res.json({
        messages,
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Patient messages error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to load conversation',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| POST /api/v1/supervision/messages
|--------------------------------------------------------------------------
*/

router.post(
  '/messages',
  authenticateToken,
  requireRole('user'),
  async (req, res) => {
    try {
      const userId =
        req.user.id;

      const {
        nutritionistId,
        message,
        mediaUrl,
      } = req.body;

      if (!nutritionistId) {
        return res.status(400).json({
          error:
            'Nutritionist ID is required',
        });
      }

      if (
        !message ||
        typeof message !==
          'string' ||
        message.trim()
          .length === 0
      ) {
        return res.status(400).json({
          error:
            'Message cannot be empty',
        });
      }

      if (
        message.trim()
          .length > 5000
      ) {
        return res.status(400).json({
          error:
            'Message cannot exceed 5000 characters',
        });
      }

      /*
       * Verify nutritionist.
       */

      const nutritionist =
        await db
          .select({
            id:
              nutritionists.id,

            isApproved:
              nutritionists
                .isApproved,

            role:
              users.role,
          })
          .from(
            nutritionists
          )
          .innerJoin(
            users,
            eq(
              nutritionists.userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                nutritionists.id,
                nutritionistId
              ),
              eq(
                users.role,
                'nutritionist'
              )
            )
          )
          .limit(1);

      if (
        nutritionist.length ===
        0
      ) {
        return res.status(404).json({
          error:
            'Nutritionist not found',
        });
      }

      if (
        !nutritionist[0]
          .isApproved
      ) {
        return res.status(403).json({
          error:
            'This nutritionist is not currently approved',
        });
      }

      /*
       * Save message.
       */

      const created =
        await db
          .insert(
            supervisionMessages
          )
          .values({
            userId,

            nutritionistId,

            senderRole:
              'user',

            message:
              message.trim(),

            mediaUrl:
              mediaUrl ||
              null,
          })
          .returning();

      return res.status(201).json({
        message:
          created[0],
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Patient send message error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to send message',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET /api/v1/supervision/dietitian/dashboard
|--------------------------------------------------------------------------
| Nutritionist dashboard.
|--------------------------------------------------------------------------
*/

router.get(
  '/dietitian/dashboard',
  authenticateToken,
  requireRole('nutritionist'),
  async (req, res) => {
    try {
      const nutritionistUserId =
        req.user.id;

      /*
       * Find nutritionist profile.
       */

      const nutritionistResult =
        await db
          .select({
            id:
              nutritionists.id,

            userId:
              nutritionists.userId,

            name:
              users.name,

            email:
              users.email,

            role:
              users.role,

            credentials:
              nutritionists
                .credentials,

            bio:
              nutritionists.bio,

            specializations:
              nutritionists
                .specializations,

            hourlyRateEtb:
              nutritionists
                .hourlyRateEtb,

            isApproved:
              nutritionists
                .isApproved,
          })
          .from(
            nutritionists
          )
          .innerJoin(
            users,
            eq(
              nutritionists
                .userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                nutritionists
                  .userId,
                nutritionistUserId
              ),
              eq(
                users.role,
                'nutritionist'
              )
            )
          )
          .limit(1);

      if (
        nutritionistResult
          .length === 0
      ) {
        return res.status(404).json({
          error:
            'Nutritionist profile not found',
        });
      }

      const nutritionist =
        nutritionistResult[0];

      /*
       * Get patients.
       */

      const patientRows =
        await db
          .select({
            id:
              users.id,

            name:
              users.name,

            email:
              users.email,

            fastingPractice:
              profiles.fastingPractice,

            healthConditions:
              profiles.healthConditions,

            age:
              profiles.age,

            gender:
              profiles.gender,

            weightKg:
              profiles.weightKg,

            targetWeightKg:
              profiles.targetWeightKg,

            heightCm:
              profiles.heightCm,

            goal:
              profiles.goal,

            budgetLevel:
              profiles.budgetLevel,
          })
          .from(users)
          .leftJoin(
            profiles,
            eq(
              users.id,
              profiles.userId
            )
          )
          .where(
            eq(
              users.role,
              'user'
            )
          );

      /*
       * Calculate risk.
       */

      const triagedPatients =
        patientRows
          .map((patient) => {
            const rawConditions =
              patient.healthConditions;

            const conditions =
              Array.isArray(
                rawConditions
              )
                ? rawConditions
                : [];

            let riskScore = 0;

            let riskReason =
              'Low Risk';

            if (
              conditions.includes(
                'anemia'
              )
            ) {
              riskScore += 3;

              riskReason =
                'High Risk - Anemia Deficiency';
            }

            if (
              conditions.includes(
                'diabetes'
              )
            ) {
              riskScore += 3;

              riskReason =
                'High Risk - Diabetes Care';
            }

            if (
              conditions.includes(
                'pregnancy'
              )
            ) {
              riskScore += 4;

              riskReason =
                'Critical Risk - Maternal Nutrition';
            }

            const riskLevel =
              riskScore >= 4
                ? 'Critical Risk'
                : riskScore >= 3
                  ? 'High Risk'
                  : 'Normal';

            return {
              id:
                patient.id,

              name:
                patient.name,

              email:
                patient.email,

              fastingPractice:
                patient
                  .fastingPractice ||
                'orthodox',

              healthConditions:
                conditions,

              age:
                patient.age,

              gender:
                patient.gender,

              weightKg:
                patient.weightKg,

              targetWeightKg:
                patient
                  .targetWeightKg,

              heightCm:
                patient.heightCm,

              goal:
                patient.goal,

              budgetLevel:
                patient
                  .budgetLevel,

              riskScore,

              riskLevel,

              riskReason,

              lastActive:
                'Today',
            };
          })
          .sort(
            (a, b) =>
              b.riskScore -
              a.riskScore
          );

      /*
       * Get appointments.
       */

      const appointmentRows =
        await db
          .select({
            id:
              appointments.id,

            userId:
              appointments
                .userId,

            userName:
              users.name,

            userEmail:
              users.email,

            nutritionistId:
              appointments
                .nutritionistId,

            scheduledAt:
              appointments
                .scheduledAt,

            status:
              appointments
                .status,

            notes:
              appointments
                .notes,

            createdAt:
              appointments
                .createdAt,
          })
          .from(
            appointments
          )
          .innerJoin(
            users,
            eq(
              appointments
                .userId,
              users.id
            )
          )
          .where(
            eq(
              appointments
                .nutritionistId,
              nutritionist.id
            )
          )
          .orderBy(
            asc(
              appointments
                .scheduledAt
            )
          );

      /*
       * Count patient messages.
       */

      const patientMessageRows =
        await db
          .select({
            id:
              supervisionMessages
                .id,

            userId:
              supervisionMessages
                .userId,

            nutritionistId:
              supervisionMessages
                .nutritionistId,

            senderRole:
              supervisionMessages
                .senderRole,

            message:
              supervisionMessages
                .message,

            sentAt:
              supervisionMessages
                .sentAt,
          })
          .from(
            supervisionMessages
          )
          .where(
            and(
              eq(
                supervisionMessages
                  .nutritionistId,
                nutritionist.id
              ),

              eq(
                supervisionMessages
                  .senderRole,
                'user'
              )
            )
          )
          .orderBy(
            desc(
              supervisionMessages
                .sentAt
            )
          );

      /*
       * Attach message information
       * to each patient.
       */

      const patientsWithMessages =
        triagedPatients.map(
          (patient) => {
            const patientMessages =
              patientMessageRows.filter(
                (message) =>
                  message.userId ===
                  patient.id
              );

            return {
              ...patient,

              messageCount:
                patientMessages
                  .length,

              hasMessages:
                patientMessages
                  .length > 0,

              lastMessage:
                patientMessages
                  .length > 0
                  ? patientMessages[0]
                      .message
                  : null,

              lastMessageAt:
                patientMessages
                  .length > 0
                  ? patientMessages[0]
                      .sentAt
                  : null,
            };
          }
        );

      const highRiskCount =
        patientsWithMessages
          .filter(
            (patient) =>
              patient.riskLevel ===
                'High Risk' ||
              patient.riskLevel ===
                'Critical Risk'
          )
          .length;

      const totalPatientMessages =
        patientMessageRows.length;

      return res.json({
        dietitian: {
          id:
            nutritionist.id,

          userId:
            nutritionist.userId,

          name:
            nutritionist.name,

          email:
            nutritionist.email,

          credentials:
            nutritionist.credentials,

          bio:
            nutritionist.bio,

          specializations:
            nutritionist
              .specializations,

          hourlyRateEtb:
            nutritionist
              .hourlyRateEtb,

          isApproved:
            nutritionist
              .isApproved,

          status:
            'Live Online',

          activeSessionRoom:
            `ethionutri-room-${nutritionist.id}`,
        },

        totalPatients:
          patientsWithMessages
            .length,

        highRiskCount,

        totalPatientMessages,

        patients:
          patientsWithMessages,

        upcomingAppointments:
          appointmentRows,
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Nutritionist dashboard error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to load nutritionist dashboard',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| GET /api/v1/supervision/dietitian/patients/:patientId/messages
|--------------------------------------------------------------------------
*/

router.get(
  '/dietitian/patients/:patientId/messages',
  authenticateToken,
  requireRole('nutritionist'),
  async (req, res) => {
    try {
      const nutritionistUserId =
        req.user.id;

      const patientId =
        req.params.patientId;

      /*
       * Find nutritionist profile.
       */

      const nutritionist =
        await db
          .select({
            id:
              nutritionists.id,

            isApproved:
              nutritionists
                .isApproved,
          })
          .from(
            nutritionists
          )
          .innerJoin(
            users,
            eq(
              nutritionists.userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                nutritionists.userId,
                nutritionistUserId
              ),
              eq(
                users.role,
                'nutritionist'
              )
            )
          )
          .limit(1);

      if (
        nutritionist.length ===
        0
      ) {
        return res.status(404).json({
          error:
            'Nutritionist profile not found',
        });
      }

      if (
        !nutritionist[0]
          .isApproved
      ) {
        return res.status(403).json({
          error:
            'Nutritionist account is not approved',
        });
      }

      const nutritionistId =
        nutritionist[0].id;

      /*
       * Verify patient.
       */

      const patient =
        await db
          .select({
            id:
              users.id,

            name:
              users.name,

            email:
              users.email,
          })
          .from(users)
          .where(
            and(
              eq(
                users.id,
                patientId
              ),

              eq(
                users.role,
                'user'
              )
            )
          )
          .limit(1);

      if (
        patient.length === 0
      ) {
        return res.status(404).json({
          error:
            'Patient not found',
        });
      }

      /*
       * Get messages.
       */

      const messages =
        await db
          .select({
            id:
              supervisionMessages
                .id,

            userId:
              supervisionMessages
                .userId,

            nutritionistId:
              supervisionMessages
                .nutritionistId,

            senderRole:
              supervisionMessages
                .senderRole,

            message:
              supervisionMessages
                .message,

            mediaUrl:
              supervisionMessages
                .mediaUrl,

            sentAt:
              supervisionMessages
                .sentAt,
          })
          .from(
            supervisionMessages
          )
          .where(
            and(
              eq(
                supervisionMessages
                  .userId,
                patientId
              ),

              eq(
                supervisionMessages
                  .nutritionistId,
                nutritionistId
              )
            )
          )
          .orderBy(
            asc(
              supervisionMessages
                .sentAt
            )
          );

      return res.json({
        patient:
          patient[0],

        patientId,

        nutritionistId,

        messages,
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Dietitian load messages error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to load patient conversation',
      });
    }
  }
);


/*
|--------------------------------------------------------------------------
| POST /api/v1/supervision/dietitian/patients/:patientId/messages
|--------------------------------------------------------------------------
*/

router.post(
  '/dietitian/patients/:patientId/messages',
  authenticateToken,
  requireRole('nutritionist'),
  async (req, res) => {
    try {
      const nutritionistUserId =
        req.user.id;

      const patientId =
        req.params.patientId;

      const {
        message,
        mediaUrl,
      } = req.body;

      /*
       * Validate message.
       */

      if (
        !message ||
        typeof message !==
          'string' ||
        message.trim()
          .length === 0
      ) {
        return res.status(400).json({
          error:
            'Message cannot be empty',
        });
      }

      if (
        message.trim()
          .length > 5000
      ) {
        return res.status(400).json({
          error:
            'Message cannot exceed 5000 characters',
        });
      }

      /*
       * Find nutritionist.
       */

      const nutritionist =
        await db
          .select({
            id:
              nutritionists.id,

            isApproved:
              nutritionists
                .isApproved,

            role:
              users.role,
          })
          .from(
            nutritionists
          )
          .innerJoin(
            users,
            eq(
              nutritionists.userId,
              users.id
            )
          )
          .where(
            and(
              eq(
                nutritionists.userId,
                nutritionistUserId
              ),
              eq(
                users.role,
                'nutritionist'
              )
            )
          )
          .limit(1);

      if (
        nutritionist.length ===
        0
      ) {
        return res.status(404).json({
          error:
            'Nutritionist profile not found',
        });
      }

      if (
        !nutritionist[0]
          .isApproved
      ) {
        return res.status(403).json({
          error:
            'Nutritionist account is not approved',
        });
      }

      const nutritionistId =
        nutritionist[0].id;

      /*
       * Verify patient.
       */

      const patient =
        await db
          .select({
            id:
              users.id,

            name:
              users.name,

            role:
              users.role,
          })
          .from(users)
          .where(
            eq(
              users.id,
              patientId
            )
          )
          .limit(1);

      if (
        patient.length ===
        0
      ) {
        return res.status(404).json({
          error:
            'Patient not found',
        });
      }

      if (
        patient[0].role !==
        'user'
      ) {
        return res.status(400).json({
          error:
            'Selected account is not a patient',
        });
      }

      /*
       * Save message.
       */

      const created =
        await db
          .insert(
            supervisionMessages
          )
          .values({
            userId:
              patientId,

            nutritionistId,

            senderRole:
              'nutritionist',

            message:
              message.trim(),

            mediaUrl:
              mediaUrl ||
              null,
          })
          .returning();

      return res.status(201).json({
        message:
          created[0],
      });
    } catch (error) {
      console.error(
        '[SUPERVISION] Dietitian send message error:',
        error
      );

      return res.status(500).json({
        error:
          'Failed to send message',
      });
    }
  }
);


module.exports = router;