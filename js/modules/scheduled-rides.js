import { db, collection, query, where, getDocs, addDoc, updateDoc, serverTimestamp } from "../firebase.js";
import { runMatching } from "./student.js";
import { state } from "./state.js";

let scheduledRideTimer = null;

export function startScheduledRidesProcessor() {
  if (scheduledRideTimer || !state.currentUser || state.currentUser.isGuest) return;
  processScheduledRides();
  scheduledRideTimer = setInterval(processScheduledRides, 10 * 60 * 1000);
}

export async function processScheduledRides() {
  if (!state.currentUser || state.currentUser.isGuest) return;

  const now = new Date();
  const in30Mins = new Date(now.getTime() + 30 * 60 * 1000);

  const snap = await getDocs(
    query(
      collection(db, "scheduledRides"),
      where("studentId", "==", state.currentUser.uid),
      where("status", "==", "pending")
    )
  );

  for (const docSnap of snap.docs) {
    const schedule = docSnap.data();
    
    const scheduledTime = schedule.scheduledFor?.toDate ? schedule.scheduledFor.toDate() : new Date(schedule.scheduledFor);
    if (scheduledTime < now || scheduledTime > in30Mins) continue;

    const fakeRequest = {
      studentId: schedule.studentId,
      studentName: schedule.studentName,
      pickup: schedule.pickup,
      dropoff: schedule.dropoff
    };

    const requestRef = await addDoc(collection(db, "rideRequests"), {
      ...fakeRequest,
      rideType: "pool",
      status: "searching",
      requestedAt: serverTimestamp()
    });

    await runMatching(requestRef.id, fakeRequest);

    await updateDoc(docSnap.ref, { status: "confirmed" });
  }
}
