const DB_NAME = "OpRidesSecureStore";
const STORE_NAME = "keys";
const KEY_ALIAS = "encKey";

// Get or generate a secure encryption key using IndexedDB
async function getEncryptionKey() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = async (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      
      const getRequest = store.get(KEY_ALIAS);
      getRequest.onsuccess = async () => {
        if (getRequest.result) {
          resolve(getRequest.result);
        } else {
          try {
            const key = await crypto.subtle.generateKey(
              { name: "AES-GCM", length: 256 },
              true,
              ["encrypt", "decrypt"]
            );
            const putRequest = store.put(key, KEY_ALIAS);
            putRequest.onsuccess = () => resolve(key);
            putRequest.onerror = () => reject(putRequest.error);
          } catch (err) {
            reject(err);
          }
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

// Encrypt string with AES-GCM
export async function encryptData(plaintext) {
  try {
    const key = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoded
    );
    
    return {
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
    };
  } catch (err) {
    console.error("Encryption failed:", err);
    throw err;
  }
}

// Decrypt string with AES-GCM
export async function decryptData(packed) {
  try {
    const key = await getEncryptionKey();
    const iv = Uint8Array.from(atob(packed.iv), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(packed.ciphertext), c => c.charCodeAt(0));
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error("Decryption failed:", err);
    throw err;
  }
}

// Check if device supports biometrics (WebAuthn)
export function isBiometricsSupported() {
  return !!(window.PublicKeyCredential && 
            navigator.credentials && 
            navigator.credentials.create);
}

// Register biometrics
export async function registerBiometrics(email, password, displayName = "") {
  if (!isBiometricsSupported()) {
    throw new Error("Biometric authentication is not supported on this device.");
  }
  
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  
  const options = {
    publicKey: {
      challenge: challenge,
      rp: { name: "OpRides" },
      user: {
        id: userId,
        name: email,
        displayName: displayName || email
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }  // RS256
      ],
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "preferred"
      },
      timeout: 60000
    }
  };
  
  const credential = await navigator.credentials.create(options);
  if (!credential) {
    throw new Error("Biometric registration was cancelled or failed.");
  }
  
  const credIdBase64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
  localStorage.setItem("oprBiometricCredId", credIdBase64);
  
  const payload = JSON.stringify({ email, password });
  const encrypted = await encryptData(payload);
  localStorage.setItem("oprBiometricData", JSON.stringify(encrypted));
  localStorage.setItem("oprBiometricsEnabled", "true");
  
  return true;
}

// Authenticate using biometrics
export async function authenticateBiometrics() {
  if (!isBiometricsSupported()) {
    throw new Error("Biometric authentication is not supported on this device.");
  }
  
  const credIdBase64 = localStorage.getItem("oprBiometricCredId");
  const encryptedDataStr = localStorage.getItem("oprBiometricData");
  
  if (!credIdBase64 || !encryptedDataStr) {
    throw new Error("Biometrics are not set up.");
  }
  
  const rawId = Uint8Array.from(atob(credIdBase64), c => c.charCodeAt(0));
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  
  const options = {
    publicKey: {
      challenge: challenge,
      allowCredentials: [{
        type: "public-key",
        id: rawId
      }],
      userVerification: "required",
      timeout: 60000
    }
  };
  
  const assertion = await navigator.credentials.get(options);
  if (!assertion) {
    throw new Error("Biometric scan failed.");
  }
  
  const encrypted = JSON.parse(encryptedDataStr);
  const decryptedStr = await decryptData(encrypted);
  return JSON.parse(decryptedStr); // returns { email, password }
}

// Disable biometrics
export function disableBiometrics() {
  localStorage.removeItem("oprBiometricCredId");
  localStorage.removeItem("oprBiometricData");
  localStorage.removeItem("oprBiometricsEnabled");
}
