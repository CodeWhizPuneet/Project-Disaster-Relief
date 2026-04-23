/**
 * dispatchService.js
 *
 * Auto-dispatch engine for the Disaster Relief platform.
 *
 * Flow (Uber-style first-accept-wins):
 *   SOS created → find nearest eligible volunteers → notify top 5 via Socket.io
 *   → wait 45s → if no accept, expand radius → repeat up to 3 rounds
 *   → escalate to admin
 *
 * All dispatch state is tracked in-memory (activeDispatches Map).
 * If the server restarts mid-dispatch the incident falls back to manual admin assignment.
 */

'use strict';

const User    = require('../models/User');
const Task    = require('../models/Task');
const Request = require('../models/Request');
const { haversineDistanceKm } = require('../utils/geo');

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const DISPATCH_ROUNDS = [
  { radiusKm: 5,  label: 'Round 1 (5 km)'  },
  { radiusKm: 10, label: 'Round 2 (10 km)' },
  { radiusKm: 20, label: 'Round 3 (20 km)' },
];
const ROUND_TIMEOUT_MS      = 45_000; // 45 seconds per round
const MAX_NOTIFY_PER_ROUND  = 5;      // notify at most 5 volunteers per round

// High/critical tasks — busy volunteers working these are NOT eligible
const BLOCKING_URGENCIES = new Set(['high', 'critical']);

// Track active dispatch timers and metadata
// key: requestId (string) → value: { timerId, round, notifiedIds: Set }
const activeDispatches = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility filter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all volunteers eligible to receive this dispatch.
 *
 * ELIGIBLE if:
 *   a) isAvailable = true  (free)
 *   b) OR busy BUT their current task is low/medium AND they're within 1km of it
 *
 * EXCLUDED if:
 *   - No live location (coordinates [0,0] or missing)
 *   - Busy on a HIGH or CRITICAL task
 *   - Already notified in a previous round of THIS dispatch
 *
 * @param {[number, number]} incidentCoords   [lng, lat]
 * @param {number}           radiusKm
 * @param {Set<string>}      alreadyNotified  ids from previous rounds
 */
async function findEligibleVolunteers(incidentCoords, radiusKm, alreadyNotified = new Set()) {
  // Step 1: fetch all volunteers with a live location within radius
  const radiusMeters = radiusKm * 1000;

  const candidates = await User.find({
    role: 'volunteer',
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: incidentCoords },
        $maxDistance: radiusMeters,
      },
    },
  })
    .select('_id name phone isAvailable trackingStatus assignedIncidentId location')
    .lean();

  // Step 2: filter and annotate
  const eligible = [];

  for (const vol of candidates) {
    const coords = vol.location?.coordinates;
    const hasLocation =
      Array.isArray(coords) &&
      coords.length === 2 &&
      Number.isFinite(coords[0]) &&
      Number.isFinite(coords[1]) &&
      !(coords[0] === 0 && coords[1] === 0);

    if (!hasLocation) continue;
    if (alreadyNotified.has(String(vol._id))) continue;

    const distanceKm = haversineDistanceKm(coords, incidentCoords);

    if (vol.isAvailable) {
      // Free volunteer — always eligible
      eligible.push({ ...vol, distanceKm, eligibilityReason: 'available' });
      continue;
    }

    // Busy volunteer — check if their current task is low/medium and they're close to it
    if (vol.assignedIncidentId) {
      const activeTask = await Task.findOne({
        volunteerId: vol._id,
        status: { $in: ['assigned', 'accepted', 'in_progress', 'en_route'] },
      })
        .populate({ path: 'requestId', select: 'urgency location' })
        .lean();

      if (!activeTask) continue;

      const taskUrgency = activeTask.requestId?.urgency;
      if (BLOCKING_URGENCIES.has(taskUrgency)) continue; // busy on high/critical — skip

      // Check distance to their current task
      const taskCoords = activeTask.requestId?.location?.coordinates;
      if (!taskCoords) continue;

      const distToCurrentTaskKm = haversineDistanceKm(coords, taskCoords);
      if (distToCurrentTaskKm > 1) continue; // too far from current — skip

      eligible.push({ ...vol, distanceKm, eligibilityReason: 'nearby-low-task' });
    }
  }

  // Sort by distance, take top N
  eligible.sort((a, b) => a.distanceKm - b.distanceKm);
  return eligible.slice(0, MAX_NOTIFY_PER_ROUND);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch round
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fires a single dispatch round:
 *  1. Re-checks that the request is still pending
 *  2. Finds eligible volunteers for this radius
 *  3. Emits 'dispatch_request' to each volunteer
 *  4. Updates dispatchState in DB
 *
 * @returns {number} count of volunteers notified
 */
async function fireDispatchRound(request, io, roundIndex, alreadyNotified) {
  // Re-fetch fresh status — another round may have resulted in acceptance
  const fresh = await Request.findById(request._id).select('status').lean();
  if (!fresh || fresh.status !== 'pending') return 0;

  const { radiusKm, label } = DISPATCH_ROUNDS[roundIndex];
  const incidentCoords = request.location.coordinates;

  const eligible = await findEligibleVolunteers(incidentCoords, radiusKm, alreadyNotified);

  if (!eligible.length) {
    console.log(`[dispatch] ${label}: no eligible volunteers found for incident ${request._id}`);
    return 0;
  }

  const payload = {
    requestId:   String(request._id),
    type:        request.type,
    urgency:     request.urgency,
    description: request.description || '',
    address:     request.location?.address || 'Location pinned on map',
    coordinates: { lat: incidentCoords[1], lng: incidentCoords[0] },
    numberOfPeople: request.numberOfPeople || 1,
    dispatchedAt: new Date().toISOString(),
    roundLabel:   label,
    // distances sent per-volunteer below
  };

  let notifiedCount = 0;
  for (const vol of eligible) {
    io.to(`user_${vol._id}`).emit('dispatch_request', {
      ...payload,
      distanceKm: Number(vol.distanceKm.toFixed(2)),
    });
    alreadyNotified.add(String(vol._id));
    notifiedCount++;
    console.log(`[dispatch] ${label}: notified volunteer ${vol._id} (${vol.distanceKm.toFixed(2)} km)`);
  }

  // Persist dispatch state
  await Request.findByIdAndUpdate(request._id, {
    'dispatchState.round': roundIndex + 1,
    'dispatchState.lastDispatchedAt': new Date(),
    $inc: { 'dispatchState.dispatchedCount': notifiedCount },
  });

  return notifiedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Starts the auto-dispatch process for a new SOS request.
 * Non-blocking — returns immediately; rounds run asynchronously.
 *
 * @param {object} request  Mongoose Request document
 * @param {object} io       Socket.io server instance
 */
async function startAutoDispatch(request, io) {
  const requestId = String(request._id);

  if (activeDispatches.has(requestId)) {
    console.warn(`[dispatch] Already dispatching for incident ${requestId}`);
    return;
  }

  const dispatchMeta = { round: 0, notifiedIds: new Set(), timerId: null };
  activeDispatches.set(requestId, dispatchMeta);

  console.log(`[dispatch] Starting auto-dispatch for incident ${requestId}`);

  /**
   * Recursive round runner — each round schedules the next via setTimeout.
   */
  async function runRound(roundIndex) {
    const meta = activeDispatches.get(requestId);
    if (!meta) return; // cancelled (task was assigned)

    // Check if already assigned before firing
    const fresh = await Request.findById(requestId).select('status').lean();
    if (!fresh || fresh.status !== 'pending') {
      console.log(`[dispatch] Incident ${requestId} no longer pending — aborting dispatch`);
      activeDispatches.delete(requestId);
      return;
    }

    if (roundIndex >= DISPATCH_ROUNDS.length) {
      // All rounds exhausted — escalate to admin
      console.log(`[dispatch] All rounds exhausted for incident ${requestId} — escalating to admin`);
      await Request.findByIdAndUpdate(requestId, { 'dispatchState.escalatedToAdmin': true });

      io.to('staff').emit('dispatch_escalated', {
        requestId,
        type:    request.type,
        urgency: request.urgency,
        address: request.location?.address || 'Location pinned on map',
        coordinates: {
          lat: request.location.coordinates[1],
          lng: request.location.coordinates[0],
        },
        message: `⚠️ No volunteer accepted after 3 rounds. Manual assignment required.`,
      });

      activeDispatches.delete(requestId);
      return;
    }

    // Fire this round
    const count = await fireDispatchRound(request, io, roundIndex, meta.notifiedIds);
    meta.round = roundIndex + 1;

    if (count === 0 && roundIndex < DISPATCH_ROUNDS.length - 1) {
      // No volunteers found at this radius — skip timeout, move to next round immediately
      console.log(`[dispatch] No volunteers at round ${roundIndex + 1}, advancing immediately`);
      return runRound(roundIndex + 1);
    }

    // Schedule next round after timeout
    meta.timerId = setTimeout(() => runRound(roundIndex + 1), ROUND_TIMEOUT_MS);
  }

  // Start round 1 (slight delay to let the HTTP response return first)
  setTimeout(() => runRound(0), 500);
}

/**
 * Cancel any pending dispatch for this request.
 * Called when a task is successfully created (volunteer accepted or admin assigned).
 *
 * @param {string} requestId
 */
function cancelDispatch(requestId) {
  const meta = activeDispatches.get(requestId);
  if (!meta) return;

  if (meta.timerId) {
    clearTimeout(meta.timerId);
  }
  activeDispatches.delete(requestId);
  console.log(`[dispatch] Cancelled dispatch for incident ${requestId}`);
}

/**
 * Atomically claim a pending request as part of volunteer self-acceptance.
 * Returns the updated Request document, or null if it was already taken.
 *
 * @param {string} requestId
 */
async function claimRequest(requestId) {
  return Request.findOneAndUpdate(
    { _id: requestId, status: 'pending' },
    { status: 'assigned' },
    { returnDocument: 'after' }
  );
}

module.exports = { startAutoDispatch, cancelDispatch, claimRequest };
