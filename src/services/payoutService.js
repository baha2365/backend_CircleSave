const { prisma } = require('../config/database');
const CONSTANTS = require('../config/constants');
const ApiError = require('../utils/ApiError');
const { recordPayout } = require('./ledgerService');
const { applyTrustDelta } = require('./trustService');
const logger = require('../utils/logger');

/**
 * Trigger payout for a cycle.
 * Rules:
 * - All APPROVED members must have PAID status for this cycle
 * - Recipient is the member whose payoutOrder === cycleNumber
 * - Platform fee deducted before disbursement
 * - Atomic: payout + ledger + mark member as hasReceived in one transaction
 *
 * @param {string} circleId
 * @param {number} cycleNumber
 * @param {string} triggeredBy - userId of organizer/admin triggering payout
 */
async function releasePayout(circleId, cycleNumber, triggeredBy) {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    include: {
      members: { where: { status: 'APPROVED' }, orderBy: { payoutOrder: 'asc' } },
    },
  });

  if (!circle) throw ApiError.notFound('Circle not found.', 'CIRCLE_NOT_FOUND');
  if (circle.status !== 'ACTIVE') throw ApiError.badRequest('Circle is not active.', 'CIRCLE_NOT_ACTIVE');

  const schedule = await prisma.paymentSchedule.findFirst({
    where: { circleId, cycleNumber },
  });
  if (!schedule) throw ApiError.notFound(`Schedule for cycle ${cycleNumber} not found.`, 'SCHEDULE_NOT_FOUND');

  // Verify all members have paid for this cycle
  const payments = await prisma.payment.findMany({
    where: { circleId, scheduleId: schedule.id },
  });

  const approvedMemberIds = circle.members.map((m) => m.userId);
  const paidMemberIds = payments.filter((p) => p.status === 'PAID').map((p) => p.userId);
  const unpaidMembers = approvedMemberIds.filter((id) => !paidMemberIds.includes(id));

  if (unpaidMembers.length > 0) {
    throw ApiError.badRequest(
      `Cannot release payout. ${unpaidMembers.length} member(s) have not paid for cycle ${cycleNumber}.`,
      'PAYOUT_MEMBERS_UNPAID'
    );
  }

  // Find recipient
  const recipient = circle.members.find((m) => m.payoutOrder === cycleNumber);
  if (!recipient) throw ApiError.notFound('Payout recipient not found.', 'RECIPIENT_NOT_FOUND');
  if (recipient.hasReceived) throw ApiError.conflict('Recipient has already received their payout.', 'PAYOUT_ALREADY_RELEASED');

  // Calculate amounts
  const totalPool = Number(circle.amount) * circle.members.length;
  const platformFee = Math.round(totalPool * (CONSTANTS.PLATFORM_FEE_PERCENT / 100) * 100) / 100;
  const netPayout = totalPool - platformFee;

  await prisma.$transaction(async (tx) => {
    // Record ledger entries
    await recordPayout(tx, {
      circleId,
      recipientMemberId: recipient.userId,
      amount: totalPool,
      scheduleId: schedule.id,
      platformFee,
    });

    // Mark member as having received payout
    await tx.circleMember.update({
      where: { id: recipient.id },
      data: { hasReceived: true },
    });

    // Advance circle to next cycle
    const isLastCycle = cycleNumber >= circle.duration;
    await tx.circle.update({
      where: { id: circleId },
      data: {
        currentCycle: isLastCycle ? cycleNumber : cycleNumber + 1,
        status: isLastCycle ? 'COMPLETED' : 'ACTIVE',
        endDate: isLastCycle ? new Date() : circle.endDate,
      },
    });

    // Audit
    await tx.auditLog.create({
      data: {
        userId: triggeredBy,
        action: 'PAYOUT_RELEASED',
        entity: 'Circle',
        entityId: circleId,
        metadata: {
          cycleNumber,
          recipientUserId: recipient.userId,
          totalPool,
          platformFee,
          netPayout,
        },
      },
    });
  });

  // Trust score reward for completing a cycle
  if (cycleNumber >= circle.duration) {
    for (const member of circle.members) {
      await applyTrustDelta(
        member.userId,
        CONSTANTS.TRUST_FULL_CIRCLE_COMPLETION,
        'Circle completed successfully',
        circleId
      );
    }
  }

  // Notify recipient
  await prisma.notification.create({
    data: {
      userId: recipient.userId,
      type: 'PAYOUT_RELEASED',
      title: 'Payout Released!',
      message: `Your payout of ${netPayout} from circle has been released.`,
      metadata: { circleId, cycleNumber, netPayout, platformFee },
    },
  });

  logger.info('Payout released', { circleId, cycleNumber, recipientUserId: recipient.userId, netPayout });

  return {
    cycleNumber,
    recipientUserId: recipient.userId,
    totalPool,
    platformFee,
    netPayout,
  };
}

module.exports = { releasePayout };