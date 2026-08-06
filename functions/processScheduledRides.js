const { onSchedule } = require("firebase-functions/v2/scheduler");
const { runMatchingForRequest } = require("./rideHelpers");
const { getFirestore } = require("firebase-admin/firestore");

const db = getFirestore();

exports.processScheduledRides = onSchedule("every 10 minutes", async () => {
  const now = new Date();
  const in30Mins = new Date(now.getTime() + 30 * 60 * 1000);

  // Find rides scheduled to depart in the next 30 minutes
  const upcoming = await db.collection("scheduledRides")
    .where("status", "==", "pending")
    .where("scheduledFor", ">=", now)
    .where("scheduledFor", "<=", in30Mins)
    .get();

  for (const doc of upcoming.docs) {
    const schedule = doc.data();

    // Treat it like a normal pool request and run matching
    const fakeRequest = {
      studentId: schedule.studentId,
      studentName: schedule.studentName,
      pickup:  schedule.pickup,
      dropoff: schedule.dropoff,
      rideType: "pool"
    };

    // Reuse the same matching logic
    const matched = await runMatchingForRequest(fakeRequest, null);

    if (matched) {
      await doc.ref.update({
        status: "confirmed",
        assignedRideId: matched.rideId
      });
    }
  }
});
