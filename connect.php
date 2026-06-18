<?php
// 1. KONEKSI KE DATABASE
$host     = "localhost";
$user     = "root";
$pass     = "";
$db_name  = "db_cyber_ai";

$koneksi = mysqli_connect($host, $user, $pass, $db_name);

if (!$koneksi) {
    die("Koneksi Gagal: " . mysqli_connect_error());
}

// 2. LOGIKA PENERIMA DATA - Kita bungkus di dalam IF
if (isset($_POST['kirim'])) {
    $nama  = $_POST['nama_user'];
    $pesan = $_POST['pesan'];

    // Kita buat variabel $sql DI DALAM IF ini biar PHP gak bingung
    $sql = "INSERT INTO tb_history (nama_user, pesan) VALUES ('$nama', '$pesan')";

    if (mysqli_query($koneksi, $sql)) {
        echo "<div style='color: lime;'>[SUCCESS] Mantap King! Data masuk.</div>";
    } else {
        echo "<div style='color: red;'>Error: " . mysqli_error($koneksi) . "</div>";
    }
}
?>

<!DOCTYPE html>
<html>
<head>
    <title>Lab Cyber AI</title>
</head>
<body style="background: #0d0f14; color: #00ff00; padding: 50px;">
    <h2>Tes Input Database</h2>
    <form action="" method="POST">
        <input type="text" name="nama_user" placeholder="Nama..." required><br><br>
        <textarea name="pesan" placeholder="Pesan..." required></textarea><br><br>
        <button type="submit" name="kirim">GASKEUN SIMPAN!</button>
    </form>
</body>
</html>