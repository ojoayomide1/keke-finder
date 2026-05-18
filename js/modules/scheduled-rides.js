import { db, collection, query, where, getDocs, addDoc, updateDoc, serverTimestamp } from "../firebase.js";
import { runMatching } from "./student.js";

// Call this once when the app loads
export function startScheduledRidesProcessor() {
  processScheduledRides(); // run once immediately
  setInterval(processScheduledRides, 10 * 60 * 1000); // then every 10 mins
}

export async function processScheduledRides() {
  const now = new Date();
  const in30Mins = new Date(now.getTime() + 30 * 60 * 1000);

  const snap = await getDocs(
    query(
      collection(db, "scheduledRides"),
      where("status", "==", "pending"),
      where("scheduledFor", ">=", now),
      where("scheduledFor", "<=", in30Mins)
    )
  );

  for (const docSnap of snap.docs) {
    const schedule = docSnap.data();
    const fakeRequest = {
      studentId: schedule.studentId,
      studentName: schedule.studentName,
      pickup: schedule.pickup,
      dropoff: schedule.dropoff
    };

    // Write a real rideRequest so the normal matching flow handles it
    const requestRef = await addDoc(collection(db, "rideRequests"), {
      ...fakeRequest,
      rideType: "pool",
      status: "searching",
      requestedAt: serverTimestamp()
    });

    await runMatching(requestRef.id, fakeRequest);

    // Mark the scheduled ride as confirmed regardless,
    // the rideRequest doc will reflect the actual match status
    await updateDoc(docSnap.ref, { status: "confirmed" });
  }
}
