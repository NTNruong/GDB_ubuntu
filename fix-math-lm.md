# Bug Fix: Thiếu flag `-lm` khi compile C với `<math.h>`

## Mô tả lỗi

Khi người dùng dùng các hàm từ `<math.h>` (như `sqrt`, `pow`, `sin`, `cos`...) trong C, runner trả về lỗi linker:

```
undefined reference to `sqrt'
collect2: error: ld returned 1 exit status
```

**Nguyên nhân:** Trên Linux/GCC, các hàm toán học nằm trong thư viện `libm` và phải được link tường minh bằng flag `-lm`. Tất cả 3 script compile C đều thiếu flag này.

---

## Files cần sửa

### 1. `docker/runner-cpp/run-c`

**Dòng cần sửa:**
```bash
gcc -std=gnu17 -O2 -pipe -Wall -Wextra /workspace/main.c -o /exec/program
```

**Sửa thành:**
```bash
gcc -std=gnu17 -O2 -pipe -Wall -Wextra /workspace/main.c -o /exec/program -lm
```

---

### 2. `docker/runner-cpp/debug-c`

**Dòng cần sửa:**
```bash
gcc -std=gnu17 -g -O0 -Wall -Wextra /workspace/main.c -o /exec/program
```

**Sửa thành:**
```bash
gcc -std=gnu17 -g -O0 -Wall -Wextra /workspace/main.c -o /exec/program -lm
```

---

### 3. `docker/runner-cpp/debug-dap-c`

**Dòng cần sửa:**
```bash
gcc -std=gnu17 -g -O0 -Wall -Wextra /workspace/main.c -o /exec/program
```

**Sửa thành:**
```bash
gcc -std=gnu17 -g -O0 -Wall -Wextra /workspace/main.c -o /exec/program -lm
```

---

## Lưu ý

- Chỉ các script C (`run-c`, `debug-c`, `debug-dap-c`) cần sửa.
- Các script C++ (`run-cpp`, `debug-cpp`, `debug-dap-cpp`) **không cần sửa** vì `g++` tự link libm.

## Sau khi sửa

Rebuild runner image để áp dụng thay đổi:

```bash
docker compose --profile runner-images build runner-cpp-image
```
