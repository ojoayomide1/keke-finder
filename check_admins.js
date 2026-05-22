const admin = require("firebase-admin");
admin.initializeApp({ projectId: "keke-finder-cd5fe" });
const db = admin.firestore();
db.collection("users").get().then(snapshot => {
    let found = false;
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.isAdmin === true) {
            console.log("Admin found:", doc.id, data);
            found = true;
        }
    });
    if (!found) {
        console.log("No admin users found.");
    }
}).catch(err => console.error(err));
