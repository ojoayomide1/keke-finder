import { db, doc, setDoc } from "./firebase.js";

/**
 * INSTRUCTIONS:
 * 1. Convert your Excel sheet to a CSV file.
 * 2. Paste the data into the arrays below.
 * 3. Call these functions from your browser console once to seed the data.
 */

export async function seedStudents(studentList) {
  console.log("Starting student seeding...");
  for (const student of studentList) {
    try {
      // Document ID is the Matric Number (e.g., "VUG/CSC/22/001")
      // Data includes the Name for verification
      await setDoc(doc(db, "authorized_students", student.matricNo.trim().toUpperCase()), {
        name: student.name.trim(),
        authorized: true,
        updatedAt: new Date()
      });
      console.log(`✅ Student ${student.matricNo} added.`);
    } catch (e) {
      console.error(`❌ Error adding student ${student.matricNo}:`, e);
    }
  }
  console.log("Student seeding complete.");
}

export async function seedRiders(riderList) {
  console.log("Starting rider seeding...");
  for (const rider of riderList) {
    try {
      // Document ID is the Plate Number (e.g., "KJA-123-XY")
      // Data includes Name and Phone for verification
      await setDoc(doc(db, "authorized_riders", rider.plateNo.trim().toUpperCase()), {
        name: rider.name.trim(),
        phone: rider.phone.trim(),
        updatedAt: new Date()
      });
      console.log(`✅ Rider ${rider.plateNo} added.`);
    } catch (e) {
      console.error(`❌ Error adding rider ${rider.plateNo}:`, e);
    }
  }
  console.log("Rider seeding complete.");
}

// Attach to window so you can call them from the browser console
window.seedStudents = seedStudents;
window.seedRiders = seedRiders;
