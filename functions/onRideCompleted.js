const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { getFirestore } = require("firebase-admin/firestore");
const { getDistance } = require("./rideHelpers");

const db = getFirestore();

async function notifyStudent(studentId, payload) {
  // Placeholder for notification logic (e.g., FCM or a notifications collection)
  console.log(`Notifying student ${studentId}:`, payload);
  await db.collection("notifications").add({
    studentId,
    ...payload,
    timestamp: new Date()
  });
}

exports.onRideCompleted = onDocumentUpdated(
  "rides/{rideId}",
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    // Only react when status changes to completed
    if (before.status === after.status) return;
    if (after.status !== "completed") return;

    const completedLocation = after.currentLocation;

    // Find queued students near where this keke just finished
    const queuedStudents = await db.collection("waitingQueue")
      .orderBy("joinedAt")   // FIFO — fairest approach
      .get();

    for (const doc of queuedStudents.docs) {
      const student = doc.data();
      const distance = getDistance(completedLocation, student.pickup);

      if (distance < 500) {
        // Notify this student — a keke just freed up near them
        await notifyStudent(student.studentId, {
          type: "ride_incoming",
          message: "A keke just finished nearby and may be heading your way.",
          eta: "2-4 mins"
        });

        await doc.ref.update({ notified: true });
        break; // Only notify the first eligible student in the queue
      }
    }
  }
);
