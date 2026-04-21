console.log("SCRIPT STARTED");

let availableKekes = [];

function becomeAvailable() {
  let locations = ["Hostel Gate", "Library", "Faculty Building", "Main Gate"];
  
  let randomLocation = locations[Math.floor(Math.random() * locations.length)];

  let rider = {
    name: "Keke Rider #" + (availableKekes.length + 1),
    location: randomLocation
  };

  availableKekes.push(rider);

  document.getElementById("riderMsg").innerText =
    "You are now available at " + randomLocation;

  updateList();
}

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
