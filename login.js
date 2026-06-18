const firebaseConfig = {
  apiKey: "AIzaSyBFJSDfU9tpbzt08SLWWKTH0jvk7EuamJE",
  authDomain: "cyber-ai-login.firebaseapp.com",
  projectId: "cyber-ai-login",
  storageBucket: "cyber-ai-login.firebasestorage.app",
  messagingSenderId: "264159618394",
  appId: "1:264159618394:web:fec6285d7b96b58b623f63"
};
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
window.loginGoogle = function() {
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider)
        .then((result) => {
            console.log("Login Berhasil!");
            // Pastikan ini juga aktif
            window.location.href = "cyber.html"; 
        })
        .catch((error) => {
            console.error("Gagal Login:", error);
        });
};
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        console.log("Sobat Cyber terdeteksi sudah login, meluncur ke halaman utama...");
    } else {
        console.log("Sobat Cyber belum login, silakan desain sepuasnya!");
    }
});