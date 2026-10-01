const express = require('express');
const router = express.Router();
const { eq } = require('drizzle-orm');

const { authenticateToken } = require('../middleware/auth');
const { db } = require('../db');
const { users, payments } = require('../db/schema');

const {
  initializeChapaPayment,
  verifyChapaPayment
} = require('../services/chapa_service');

// ============================================================
// INITIALIZE CHAPA PAYMENT
// POST /api/v1/payments/chapa/initialize
// ============================================================

router.post(
  '/chapa/initialize',
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const {
        amountEtb = 799,
        phoneNumber
      } = req.body;

      // ------------------------------------------
      // Find user
      // ------------------------------------------

      const userResult = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const user = userResult[0];

      if (!user) {
        return res.status(404).json({
          error: 'User not found'
        });
      }

      // ------------------------------------------
      // Generate transaction reference
      // ------------------------------------------

      const txRef =
        `ethionutri-tx-${Date.now()}`;

      // ------------------------------------------
      // Initialize with Chapa
      // ------------------------------------------

      const paymentResult =
        await initializeChapaPayment({
          txRef,
          amountEtb,
          email: user.email,
          name: user.name,
          phoneNumber
        });

      // ------------------------------------------
      // Save pending payment
      // ------------------------------------------

      await db
        .insert(payments)
        .values({
          userId,
          txRef,
          amountEtb: Number(amountEtb),
          status: 'pending',
          paymentMethod: 'chapa',
          rawResponse:
            paymentResult.raw || {}
        });

      // ------------------------------------------
      // Return checkout URL
      // ------------------------------------------

      return res.status(200).json({
        success: true,
        status: 'success',
        message:
          'Payment initialized successfully',

        checkoutUrl:
          paymentResult.checkoutUrl,

        txRef,

        isSimulation:
          paymentResult.isSimulation || false
      });

    } catch (err) {
      console.error(
        'Payment Initialization Error:',
        err
      );

      return res.status(500).json({
        success: false,
        error:
          'Failed to initialize payment',
        details: err.message
      });
    }
  }
);


// ============================================================
// VERIFY PAYMENT
// GET /api/v1/payments/chapa/verify/:txRef
// ============================================================

router.get(
  '/chapa/verify/:txRef',
  authenticateToken,
  async (req, res) => {
    try {
      const { txRef } = req.params;

      // ------------------------------------------
      // Ask Chapa for REAL transaction status
      // ------------------------------------------

      const chapaResult =
        await verifyChapaPayment(txRef);

      console.log(
        'Verification result:',
        chapaResult
      );

      // ------------------------------------------
      // Payment not successful
      // ------------------------------------------

      if (!chapaResult.verified) {
        return res.status(200).json({
          verified: false,
          status:
            chapaResult.status || 'pending',
          message:
            'Payment has not been confirmed by Chapa.',
          txRef
        });
      }

      // ------------------------------------------
      // Find payment
      // ------------------------------------------

      const paymentResult = await db
        .select()
        .from(payments)
        .where(eq(payments.txRef, txRef))
        .limit(1);

      const paymentRecord =
        paymentResult[0];

      if (!paymentRecord) {
        return res.status(404).json({
          verified: false,
          error:
            'Payment record not found'
        });
      }

      // ------------------------------------------
      // Mark payment successful
      // ------------------------------------------

      await db
        .update(payments)
        .set({
          status: 'success'
        })
        .where(
          eq(payments.txRef, txRef)
        );

      // ------------------------------------------
      // Activate Premium
      // ------------------------------------------

      await db
        .update(users)
        .set({
          isPremium: true,
          paymentStatus: 'active_premium'
        })
        .where(
          eq(
            users.id,
            paymentRecord.userId
          )
        );

      return res.status(200).json({
        verified: true,
        status: 'success',
        isPremiumActive: true,
        message:
          'Payment verified successfully. EthioNutri Premium is now active.',
        txRef
      });

    } catch (err) {
      console.error(
        'Payment Verification Error:',
        err
      );

      return res.status(500).json({
        verified: false,
        error:
          'Payment verification failed',
        details: err.message
      });
    }
  }
);


// ============================================================
// CHAPA CALLBACK
// POST /api/v1/payments/chapa/callback
// ============================================================

router.post(
  '/chapa/callback',
  async (req, res) => {
    try {
      console.log(
        'Chapa callback received:',
        req.body
      );

      const txRef =
        req.body?.tx_ref ||
        req.body?.trx_ref;

      if (!txRef) {
        return res.status(400).json({
          error:
            'Transaction reference missing'
        });
      }

      const chapaResult =
        await verifyChapaPayment(txRef);

      if (!chapaResult.verified) {
        return res.status(200).json({
          status: 'pending'
        });
      }

      const paymentResult =
        await db
          .select()
          .from(payments)
          .where(
            eq(payments.txRef, txRef)
          )
          .limit(1);

      const payment =
        paymentResult[0];

      if (payment) {
        await db
          .update(payments)
          .set({
            status: 'success'
          })
          .where(
            eq(
              payments.txRef,
              txRef
            )
          );

        await db
          .update(users)
          .set({
            isPremium: true,
            paymentStatus:
              'active_premium'
          })
          .where(
            eq(
              users.id,
              payment.userId
            )
          );
      }

      return res.status(200).json({
        status: 'success'
      });

    } catch (err) {
      console.error(
        'Chapa Callback Error:',
        err
      );

      return res.status(500).json({
        error: err.message
      });
    }
  }
);


// ============================================================
// SUCCESS RETURN
// GET /api/v1/payments/success
// ============================================================

router.get(
  '/success',
  (req, res) => {
    const txRef =
      req.query.tx_ref;

    if (!txRef) {
      return res
        .status(400)
        .send(
          'Missing transaction reference'
        );
    }

    const frontendUrl =
      process.env.FRONTEND_URL ||
      'http://localhost:3000';

    const redirectUrl =
      `${frontendUrl}/payment-success?tx_ref=${encodeURIComponent(txRef)}`;

    return res.redirect(
      redirectUrl
    );
  }
);


module.exports = router;