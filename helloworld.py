def kalkulator():
    print("Pilih operasi:")
    print("1. Tambah")
    print("2. Kurang")
    print("3. Kali")
    print("4. Bagi")

    pilihan = input("Masukkan pilihan (1/2/3/4): ")

    if pilihan in ['1', '2', '3', '4']:
        num1 = float(input("Masukkan angka pertama: "))
        num2 = float(input("Masukkan angka kedua: "))

        if pilihan == '1':
            print(f"{num1} + {num2} = {num1 + num2}")
        elif pilihan == '2':
            print(f"{num1} - {num2} = {num1 - num2}")
        elif pilihan == '3':
            print(f"{num1} * {num2} = {num1 * num2}")
        elif pilihan == '4':
            if num2 != 0:
                print(f"{num1} / {num2} = {num1 / num2}")
            else:
                print("Error! Pembagian dengan nol.")
    else:
        print("Pilihan tidak valid.")

kalkulator()