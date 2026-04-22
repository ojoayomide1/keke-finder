console.log("SCRIPT STARTED");

let availableKekes = [];

window.becomeAvailable = async function () {
  let name = prompt("Enter your name or keke number:");
  if (!name) return;

  if (!navigator.geolocation) {
    alert("Geolocation is not supported on your device");
    return;
  }

  navigator.geolocation.getCurrentPosition(async (position) => {
    let lat = position.coords.latitude;
    let lng = position.coords.longitude;

    await addDoc(collection(db, "kekes"), {
      name: name,
      lat: lat,
      lng: lng,
      time: Date.now()
    });

    document.getElementById("riderMsg").innerText =
      "You are now live at your current location 📍";
  },
  (error) => {
    alert("Location access denied ❌");
  });
};

function requestKeke() {
  if (availableKekes.length > 0) {
    let nearest = availableKekes[0];

    document.getElementById("studentMsg").innerText =
      "🚖 " + nearest.name + " is at " + nearest.location;
  } else {
    document.getElementById("studentMsg").innerText =
      "No keke available right now 😢";
  }
}

function updateList() {
  let list = document.getElementById("kekeList");
  list.innerHTML = "";

  availableKekes.forEach((keke) => {
    let li = document.createElement("li");
    li.innerText = `${keke.name} - ${keke.location}`;
    list.appendChild(li);
  });
}
