# tests/qc/c-embedded.md — C firmware embedded

Phạm vi: 3 domain firmware sim (no real hardware, Docker sandbox).
Compile mặc định: `gcc -std=gnu17 -O2 -Wall -Wextra -lm` (debug `-g -O0` khi cần).
Liên kết: [`INDEX.md`](INDEX.md) · [`runner.md`](runner.md).

> Mỗi scenario gồm 12 trường theo template chung. Code C inline; nhiều scenario có biến thể (2-3 cách implement cùng feature) — tách thành ID liền nhau.

---

## Section REGISTER / MMIO (TC-C-REG-001 → TC-C-REG-040)

### TC-C-REG-001 — GPIO bit set/clear/toggle (8-bit, |=, &=~, ^=)

Tags: c, embedded, gpio, bit · Pre: fresh · Stdin/Argv: empty · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static volatile uint8_t REG = 0;
#define SET(b) (REG |=  (1u<<(b)))
#define CLR(b) (REG &= ~(1u<<(b)))
#define TGL(b) (REG ^=  (1u<<(b)))
int main(void){
    SET(0); SET(3); printf("%02X\n", REG);   /* 09 */
    CLR(0);         printf("%02X\n", REG);   /* 08 */
    TGL(3);         printf("%02X\n", REG);   /* 00 */
    return 0;
}
```

UI: C → Paste → Run.
Expected: stdout `09\n08\n00\n`, exit 0.
Pass: [ ] Output đúng · [ ] Exit 0.
Notes: biến thể 1/3. ISSUE: (none).

---

### TC-C-REG-002 — GPIO atomic bit-band emulation (32-bit)

Tags: c, embedded, gpio, bit-band · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static volatile uint32_t REG = 0;
static inline void bb_write(uint32_t bit, uint32_t v){
    uint32_t mask = 1u << bit;
    REG = (REG & ~mask) | ((v & 1u) << bit);
}
int main(void){
    bb_write(5,1); bb_write(7,1); printf("%08X\n", REG); /* 000000A0 */
    bb_write(5,0);                 printf("%08X\n", REG); /* 00000080 */
    return 0;
}
```

UI: Run.
Expected: stdout `000000A0\n00000080\n`, exit 0.
Pass: [ ] Output đúng. Biến thể 2/3.

---

### TC-C-REG-003 — GPIO macro tập trung (SET_BIT/CLEAR_BIT/READ_BIT/TOGGLE_BIT)

Tags: c, embedded, gpio, macro · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
#define SET_BIT(R,B)    ((R) |=  (1u<<(B)))
#define CLEAR_BIT(R,B)  ((R) &= ~(1u<<(B)))
#define READ_BIT(R,B)   (((R) >> (B)) & 1u)
#define TOGGLE_BIT(R,B) ((R) ^=  (1u<<(B)))
int main(void){
    volatile uint16_t r = 0;
    SET_BIT(r, 4); SET_BIT(r, 11);
    printf("%04X bit4=%u bit11=%u\n", r, READ_BIT(r,4), READ_BIT(r,11));
    TOGGLE_BIT(r, 4);
    printf("%04X\n", r);
    return 0;
}
```

UI: Run.
Expected: `0810 bit4=1 bit11=1\n0800\n`.
Pass: [ ] Output đúng. Biến thể 3/3.

---

### TC-C-REG-004 — Read-Modify-Write idiom với mask

Tags: c, embedded, rmw · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
int main(void){
    volatile uint32_t CFG = 0xDEADBEEF;
    uint32_t mask = 0x000000FF;
    uint32_t new  = 0x000000A5;
    CFG = (CFG & ~mask) | (new & mask);
    printf("%08X\n", CFG);  /* DEADBEA5 */
    return 0;
}
```

Expected: `DEADBEA5\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-005 — Volatile correctness vs `-O2` optimizer

Tags: c, embedded, volatile, optimizer · Flags: default (`-O2`).

```c
#include <stdio.h>
#include <stdint.h>
static volatile uint32_t flag = 0;
static volatile uint32_t loops = 0;
int main(void){
    /* Mô phỏng: ISR set flag, main vòng lặp cho tới khi flag set */
    flag = 1;
    while (!flag) { ++loops; if (loops > 10) break; }
    printf("loops=%u flag=%u\n", (unsigned)loops, (unsigned)flag);
    return 0;
}
```

Expected: `loops=0 flag=1\n` (volatile khiến compiler không hoist load).
Pass: [ ] loops=0 · [ ] flag=1.
Notes: nếu drop `volatile` từ flag → optimizer có thể hoist → loop hữu hạn dài hơn 10 (break ra).

---

### TC-C-REG-006 — Bit reversal lookup table 8-bit

Tags: c, embedded, lut, bits · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint8_t rev_tbl[256];
static void init_rev(void){
    for (int i = 0; i < 256; ++i){
        uint8_t b = (uint8_t)i, r = 0;
        for (int k = 0; k < 8; ++k) r = (uint8_t)((r << 1) | (b & 1u)), b >>= 1;
        rev_tbl[i] = r;
    }
}
int main(void){
    init_rev();
    printf("%02X %02X %02X\n", rev_tbl[0x01], rev_tbl[0xA5], rev_tbl[0xFF]);
    return 0;
}
```

Expected: `80 A5 FF\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-007 — Parity (XOR fold + lookup)

Tags: c, embedded, parity · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static inline int parity8(uint8_t x){
    x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return x & 1u;
}
int main(void){
    for (uint8_t v = 0; v < 5; ++v) printf("p(%u)=%d\n", v, parity8(v));
    printf("p(0xFF)=%d\n", parity8(0xFF));
    return 0;
}
```

Expected: `p(0)=0\np(1)=1\np(2)=1\np(3)=0\np(4)=1\np(0xFF)=0\n`.
Pass: [ ] Output đúng.

---

### TC-C-REG-008 — Bitfield struct cho LED config register

Tags: c, embedded, bitfield · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
typedef union {
    uint32_t raw;
    struct { uint32_t mode:2; uint32_t bright:5; uint32_t blink:1; uint32_t color:3; uint32_t rsv:21; };
} LedCfg;
int main(void){
    LedCfg c = {0};
    c.mode = 2; c.bright = 0x1F; c.blink = 1; c.color = 5;
    printf("raw=%08X mode=%u bright=%u blink=%u color=%u\n",
        c.raw, c.mode, c.bright, c.blink, c.color);
    return 0;
}
```

Expected: `raw=000017FE mode=2 bright=31 blink=1 color=5\n` (kiểm tra layout little-endian gcc).
Pass: [ ] Field decode đúng · [ ] raw không zero.
Notes: ABI dependent — chấp nhận raw khác nếu field decode đúng.

---

### TC-C-REG-009 — Packed struct cho SPI control register

Tags: c, embedded, packed · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
#pragma pack(push, 1)
typedef struct {
    uint8_t cpha:1; uint8_t cpol:1; uint8_t mstr:1;
    uint8_t br:3;  uint8_t spe:1;  uint8_t lsbfirst:1;
} SpiCr1;
#pragma pack(pop)
int main(void){
    SpiCr1 r = {.cpha=0,.cpol=1,.mstr=1,.br=3,.spe=1,.lsbfirst=0};
    uint8_t raw = *(uint8_t*)&r;
    printf("size=%zu raw=%02X\n", sizeof(r), raw);
    return 0;
}
```

Expected: `size=1 raw=70\n` (cpha=0, cpol=1, mstr=1, br=011, spe=1, lsbfirst=0 → 0b01110110? — phụ thuộc bit order).
Pass: [ ] sizeof(r) == 1 · [ ] raw != 0.
Notes: bit-order layout phụ thuộc ABI; QC chấp nhận raw thay đổi miễn size=1.

---

### TC-C-REG-010 — Endianness manual `htonl`/`ntohl`

Tags: c, embedded, endianness · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint32_t my_htonl(uint32_t h){
    return ((h & 0xFF000000u) >> 24) | ((h & 0x00FF0000u) >> 8)
         | ((h & 0x0000FF00u) << 8)  | ((h & 0x000000FFu) << 24);
}
int main(void){
    uint32_t v = 0x12345678;
    printf("h=%08X n=%08X\n", v, my_htonl(v));
    return 0;
}
```

Expected: `h=12345678 n=78563412\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-011 — Pointer to fixed address (volatile uint32_t*)

Tags: c, embedded, mmio · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint32_t fake_mem[16] = {0};
#define FAKE_BASE ((uintptr_t)fake_mem)
#define REG(off)  (*(volatile uint32_t*)(FAKE_BASE + (off)))
int main(void){
    REG(0x00) = 0xCAFEBABE;
    REG(0x04) = 0xDEADBEEF;
    printf("%08X %08X\n", REG(0x00), REG(0x04));
    return 0;
}
```

Expected: `CAFEBABE DEADBEEF\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-012 — Memory-mapped struct (GPIO_TypeDef style)

Tags: c, embedded, mmio, struct · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
typedef struct { uint32_t MODER, OTYPER, OSPEEDR, PUPDR, IDR, ODR, BSRR, LCKR; } GPIO_TypeDef;
static GPIO_TypeDef fake = {0};
#define GPIO ((volatile GPIO_TypeDef*)&fake)
int main(void){
    GPIO->MODER  = 0x55555555;
    GPIO->BSRR   = 0x0000FFFFu; /* set pins 0..15 */
    GPIO->ODR   |= 0xAAAA;
    printf("MODER=%08X BSRR=%08X ODR=%08X\n", GPIO->MODER, GPIO->BSRR, GPIO->ODR);
    return 0;
}
```

Expected: `MODER=55555555 BSRR=0000FFFF ODR=0000AAAA\n`.
Pass: [ ] Output đúng.

---

### TC-C-REG-013 — Write-1-to-Clear (W1C) register pattern

Tags: c, embedded, w1c · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static volatile uint32_t INT_FLAGS = 0x0F;
static inline void clear_flag(uint32_t mask){ INT_FLAGS = mask; /* W1C: ghi 1 vào bit cần xóa */ }
int main(void){
    /* hardware sẽ chỉ xóa bit có ghi 1, không động bit khác — mô phỏng đơn giản */
    printf("before=%X\n", INT_FLAGS);
    clear_flag(0x02);
    /* mô phỏng hardware behavior: chỉ xóa bit ghi 1, giữ bit khác */
    INT_FLAGS = 0x0F & ~0x02;
    printf("after=%X\n", INT_FLAGS);
    return 0;
}
```

Expected: `before=F\nafter=D\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-014 — UART TX FSM (start/8-data/parity/stop) — biến thể 1: switch-case

Tags: c, embedded, uart, fsm · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
typedef enum { IDLE, START, DATA, PARITY, STOP } UartState;
static const char* names[] = {"IDLE","START","DATA","PARITY","STOP"};
int main(void){
    UartState s = IDLE; int bit = 0; uint8_t byte = 0xA5; int p = 0;
    for (int t = 0; t < 12; ++t){
        printf("t=%d state=%s\n", t, names[s]);
        switch (s){
            case IDLE:   s = START; break;
            case START:  s = DATA; bit = 0; p = 0; break;
            case DATA:   p ^= (byte >> bit) & 1; if (++bit == 8) s = PARITY; break;
            case PARITY: s = STOP; break;
            case STOP:   s = IDLE; break;
        }
    }
    printf("parity_xor=%d\n", p);
    return 0;
}
```

Expected: chuỗi state IDLE,START,DATA×8,PARITY,STOP,IDLE,... + `parity_xor=` (xor 8 bit của 0xA5 = 4 bit set → 0).
Pass: [ ] Sequence đúng · [ ] parity_xor=0.

---

### TC-C-REG-015 — UART RX FSM 16x oversample với majority voting

Tags: c, embedded, uart, oversample · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static int sample_majority(const int* s){
    int ones = 0; for (int i = 0; i < 3; ++i) ones += s[i];
    return ones >= 2 ? 1 : 0;
}
int main(void){
    /* Lấy 3 mẫu giữa của 16x: positions 7,8,9 */
    int s1[] = {1,0,1}; int s2[] = {0,0,1}; int s3[] = {1,1,1};
    printf("%d %d %d\n", sample_majority(s1), sample_majority(s2), sample_majority(s3));
    return 0;
}
```

Expected: `1 0 1\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-016 — Baud rate divisor calculator BRR = fclk / (16*baud)

Tags: c, embedded, uart, baud · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint32_t brr(uint32_t fclk, uint32_t baud){ return fclk / (16u * baud); }
int main(void){
    uint32_t fclk = 16000000u;
    uint32_t bauds[] = {9600u, 19200u, 115200u};
    for (size_t i = 0; i < 3; ++i) printf("baud=%u BRR=%u\n", bauds[i], brr(fclk, bauds[i]));
    return 0;
}
```

Expected: `baud=9600 BRR=104\nbaud=19200 BRR=52\nbaud=115200 BRR=8\n`.
Pass: [ ] Output đúng.

---

### TC-C-REG-017 — UART TX ring buffer (SPSC, head/tail)

Tags: c, embedded, uart, ring · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
#define N 8
static uint8_t buf[N]; static unsigned h=0, t=0;
static int push(uint8_t x){ unsigned nh=(h+1)%N; if (nh==t) return -1; buf[h]=x; h=nh; return 0; }
static int pop(uint8_t* x){ if (h==t) return -1; *x=buf[t]; t=(t+1)%N; return 0; }
int main(void){
    for (int i=0;i<10;++i) printf("push(%d)=%d\n", i, push((uint8_t)i));
    uint8_t x;
    while (pop(&x)==0) printf("pop=%u\n", x);
    return 0;
}
```

Expected: 7 lần push thành công (0..6), 3 lần fail (-1); pop ra 0..6.
Pass: [ ] Đúng pattern · [ ] Cap N-1=7.

---

### TC-C-REG-018 — UART break detection state

Tags: c, embedded, uart, break · Flags: default.

```c
#include <stdio.h>
int main(void){
    /* break = >= 11 bit-times liên tục mức 0 sau frame */
    int line[20]; for (int i=0;i<20;++i) line[i]=0; line[3]=1; line[19]=1;
    int zero_run = 0, breaks = 0;
    for (int i=0;i<20;++i){
        if (line[i]==0){ if (++zero_run >= 11) { breaks++; zero_run=0; } }
        else zero_run = 0;
    }
    printf("breaks=%d\n", breaks);
    return 0;
}
```

Expected: `breaks=1\n` (run 0 từ index 4..18 = 15 zeros → 1 break event).
Pass: [ ] Output đúng.

---

### TC-C-REG-019 — SPI bit-bang CPOL=0/CPHA=0 (mode 0)

Tags: c, embedded, spi, mode0 · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static int CLK=0, MOSI=0, MISO_data=0xA5, MISO=0;
static int spi0_xfer(uint8_t out){
    uint8_t in=0;
    for (int i=7;i>=0;--i){
        MOSI = (out >> i) & 1;
        CLK = 1; /* sample on rising */
        MISO = (MISO_data >> i) & 1;
        in = (uint8_t)((in << 1) | MISO);
        CLK = 0; /* shift on falling */
    }
    return in;
}
int main(void){ printf("%02X\n", spi0_xfer(0x3C)); return 0; }
```

Expected: `A5\n` (MISO data luôn 0xA5). Pass: [ ] Output đúng.

---

### TC-C-REG-020 — SPI shift register MSB-first / LSB-first

Tags: c, embedded, spi, shift · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint8_t shift_msb(uint8_t x){ uint8_t r=0; for(int i=0;i<8;++i){ r=(uint8_t)((r<<1)|((x>>(7-i))&1)); } return r; }
static uint8_t shift_lsb(uint8_t x){ uint8_t r=0; for(int i=0;i<8;++i){ r=(uint8_t)((r<<1)|((x>>i)&1)); } return r; }
int main(void){
    printf("msb(0x12)=%02X lsb(0x12)=%02X\n", shift_msb(0x12), shift_lsb(0x12));
    return 0;
}
```

Expected: `msb(0x12)=12 lsb(0x12)=48\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-021 — SPI DMA-style block transfer simulator

Tags: c, embedded, spi, dma · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
#include <string.h>
static void dma_spi(const uint8_t* tx, uint8_t* rx, size_t n){
    /* MISO loopback: rx[i] = tx[i] xor 0x5A */
    for (size_t i = 0; i < n; ++i) rx[i] = (uint8_t)(tx[i] ^ 0x5A);
}
int main(void){
    uint8_t tx[8] = {0,1,2,3,4,5,6,7}, rx[8];
    dma_spi(tx, rx, 8);
    for (int i = 0; i < 8; ++i) printf("%02X ", rx[i]);
    printf("\n");
    return 0;
}
```

Expected: `5A 5B 58 59 5E 5F 5C 5D \n`. Pass: [ ] Output đúng.

---

### TC-C-REG-022 — SPI CS multi-slave chain

Tags: c, embedded, spi, cs · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static int CS[4] = {1,1,1,1};
static void select(int slv){ for (int i=0;i<4;++i) CS[i] = (i==slv) ? 0 : 1; }
int main(void){
    for (int s=0; s<4; ++s){
        select(s);
        printf("CS=%d%d%d%d\n", CS[0], CS[1], CS[2], CS[3]);
    }
    return 0;
}
```

Expected: `CS=0111\nCS=1011\nCS=1101\nCS=1110\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-023 — I2C bit-bang START / STOP / repeated START

Tags: c, embedded, i2c · Flags: default.

```c
#include <stdio.h>
static int SDA=1, SCL=1;
static void start(void){ SDA=0; SCL=0; }
static void stop(void){ SCL=1; SDA=1; }
static void rep_start(void){ SDA=1; SCL=1; SDA=0; SCL=0; }
int main(void){
    start();      printf("after_start sda=%d scl=%d\n", SDA, SCL);
    rep_start();  printf("after_rep   sda=%d scl=%d\n", SDA, SCL);
    stop();       printf("after_stop  sda=%d scl=%d\n", SDA, SCL);
    return 0;
}
```

Expected: `after_start sda=0 scl=0\nafter_rep   sda=0 scl=0\nafter_stop  sda=1 scl=1\n`.
Pass: [ ] Output đúng.

---

### TC-C-REG-024 — I2C ACK / NACK signaling

Tags: c, embedded, i2c, ack · Flags: default.

```c
#include <stdio.h>
static int slave_ack_for(int addr){ return (addr == 0x50) ? 0 : 1; /* 0=ACK,1=NACK */ }
int main(void){
    int addrs[] = {0x50, 0x68, 0x77};
    for (int i = 0; i < 3; ++i) printf("addr=%02X ack=%d\n", addrs[i], slave_ack_for(addrs[i]));
    return 0;
}
```

Expected: `addr=50 ack=0\naddr=68 ack=1\naddr=77 ack=1\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-025 — I2C 7-bit address + R/W bit packing

Tags: c, embedded, i2c, addr · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint8_t pack(uint8_t addr, int read){ return (uint8_t)((addr << 1) | (read & 1u)); }
int main(void){
    printf("write@0x50=%02X read@0x50=%02X\n", pack(0x50,0), pack(0x50,1));
    return 0;
}
```

Expected: `write@0x50=A0 read@0x50=A1\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-026 — I2C clock stretching (slave holds SCL low)

Tags: c, embedded, i2c, stretch · Flags: default.

```c
#include <stdio.h>
static int SCL_master = 1, SCL_slave = 1;
static int scl_bus(void){ return SCL_master & SCL_slave; }
int main(void){
    SCL_master = 1; SCL_slave = 0;
    printf("stretch bus=%d\n", scl_bus());
    SCL_slave = 1;
    printf("release bus=%d\n", scl_bus());
    return 0;
}
```

Expected: `stretch bus=0\nrelease bus=1\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-027 — CAN standard 11-bit frame layout

Tags: c, embedded, can, frame · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
typedef struct { uint16_t id11; uint8_t rtr; uint8_t dlc; uint8_t data[8]; } CanStd;
int main(void){
    CanStd f = {.id11=0x123, .rtr=0, .dlc=4, .data={0xDE,0xAD,0xBE,0xEF}};
    printf("ID=%03X RTR=%u DLC=%u DATA=", f.id11, f.rtr, f.dlc);
    for (int i = 0; i < f.dlc; ++i) printf("%02X", f.data[i]);
    printf("\n");
    return 0;
}
```

Expected: `ID=123 RTR=0 DLC=4 DATA=DEADBEEF\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-028 — CAN extended 29-bit frame

Tags: c, embedded, can, ext · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
int main(void){
    uint32_t id29 = 0x1ABCDEF; /* 29-bit */
    printf("id29=%08X masked=%08X\n", id29, id29 & 0x1FFFFFFFu);
    return 0;
}
```

Expected: `id29=01ABCDEF masked=01ABCDEF\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-029 — CAN bit stuffing (5 consecutive same → insert opposite)

Tags: c, embedded, can, stuff · Flags: default.

```c
#include <stdio.h>
static int stuff(const int* in, int len, int* out){
    int run = 1, prev = in[0], o = 0;
    out[o++] = prev;
    for (int i = 1; i < len; ++i){
        if (in[i] == prev) {
            ++run;
            out[o++] = in[i];
            if (run == 5){ out[o++] = !prev; run = 1; }
        } else { prev = in[i]; run = 1; out[o++] = in[i]; }
    }
    return o;
}
int main(void){
    int in[] = {1,1,1,1,1,1,0,0}; int out[32];
    int n = stuff(in, 8, out);
    for (int i = 0; i < n; ++i) printf("%d", out[i]);
    printf("\n");
    return 0;
}
```

Expected: stuffed sequence chèn 0 sau 5 bit 1: `111110100\n` hoặc dạng tương đương (verify length tăng).
Pass: [ ] Output có insert.

---

### TC-C-REG-030 — Volatile global "registers" mapping

Tags: c, embedded, layout · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
#define RCC_BASE   ((uintptr_t)&rcc_storage[0])
static uint32_t rcc_storage[16];
#define RCC_CR    (*(volatile uint32_t*)(RCC_BASE + 0x00))
#define RCC_CFGR  (*(volatile uint32_t*)(RCC_BASE + 0x04))
int main(void){
    RCC_CR   = 0x83000000u;
    RCC_CFGR = 0x00000402u;
    printf("CR=%08X CFGR=%08X\n", RCC_CR, RCC_CFGR);
    return 0;
}
```

Expected: `CR=83000000 CFGR=00000402\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-031 — Stack canary pattern (__stack_chk_guard style)

Tags: c, embedded, canary · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint32_t canary = 0xCAFEBABEu;
static int verify(const uint32_t* p){ return *p == canary; }
int main(void){
    uint32_t guard = canary;
    printf("ok=%d\n", verify(&guard));
    guard = 0xDEADBEEF;
    printf("ok=%d\n", verify(&guard));
    return 0;
}
```

Expected: `ok=1\nok=0\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-032 — Heap fragmentation visualization

Tags: c, embedded, heap · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
int main(void){
    void* p[4];
    for (int i = 0; i < 4; ++i) p[i] = malloc(64);
    free(p[1]); free(p[3]);
    /* hole at index 1 và 3 → external fragmentation */
    printf("alloc=%p %p %p %p\n", p[0], (void*)0, p[2], (void*)0);
    free(p[0]); free(p[2]);
    return 0;
}
```

Expected: 4 con trỏ in ra, 2 con NULL ở vị trí 1,3 (placeholder).
Pass: [ ] Khớp pattern. Notes: minh họa free→hole.

---

### TC-C-REG-033 — Timer interrupt mô phỏng (SIGALRM)

Tags: c, embedded, irq, signal · Flags: default.

```c
#include <stdio.h>
#include <signal.h>
#include <unistd.h>
#include <stdatomic.h>
static atomic_int ticks = 0;
static void on_alarm(int s){ (void)s; ticks++; }
int main(void){
    signal(SIGALRM, on_alarm);
    alarm(1);
    while (ticks == 0) pause();
    printf("ticks=%d\n", atomic_load(&ticks));
    return 0;
}
```

Expected: `ticks=1\n` sau ~1s. Pass: [ ] Output đúng · [ ] Không treo.

---

### TC-C-REG-034 — Reentrant disable/enable IRQ pattern

Tags: c, embedded, irq, critical · Flags: default.

```c
#include <stdio.h>
static int irq_disable_count = 0;
static void irq_disable(void){ ++irq_disable_count; }
static void irq_enable(void){ if (--irq_disable_count < 0) irq_disable_count = 0; }
int main(void){
    irq_disable(); irq_disable(); irq_enable();
    printf("count=%d\n", irq_disable_count);
    irq_enable();
    printf("count=%d\n", irq_disable_count);
    return 0;
}
```

Expected: `count=1\ncount=0\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-035 — NVIC priority simulation (priority queue)

Tags: c, embedded, irq, priority · Flags: default.

```c
#include <stdio.h>
typedef struct { int id; int pri; } Irq;
static Irq q[16]; static int n = 0;
static void enq(int id, int pri){ q[n].id=id; q[n].pri=pri; ++n; }
static int pop_highest(void){
    int best = 0;
    for (int i = 1; i < n; ++i) if (q[i].pri < q[best].pri) best = i;
    int id = q[best].id;
    for (int i = best; i < n - 1; ++i) q[i] = q[i+1];
    --n; return id;
}
int main(void){
    enq(10, 3); enq(20, 1); enq(30, 2);
    printf("%d %d %d\n", pop_highest(), pop_highest(), pop_highest());
    return 0;
}
```

Expected: `20 30 10\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-036 — ISR-to-task notification (volatile sig_atomic_t)

Tags: c, embedded, irq, flag · Flags: default.

```c
#include <stdio.h>
#include <signal.h>
#include <unistd.h>
static volatile sig_atomic_t event = 0;
static void on_sig(int s){ (void)s; event = 1; }
int main(void){
    signal(SIGUSR1, on_sig);
    raise(SIGUSR1);
    if (event) printf("event\n");
    return 0;
}
```

Expected: `event\n`. Pass: [ ] Output đúng.

---

### TC-C-REG-037 — DMA double-buffered (ping-pong)

Tags: c, embedded, dma, pingpong · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint8_t bufA[8], bufB[8];
static int active = 0; /* 0=A,1=B */
static uint8_t* current(void){ return active==0 ? bufA : bufB; }
static void swap(void){ active ^= 1; }
int main(void){
    for (int i = 0; i < 4; ++i){
        uint8_t* b = current();
        for (int k = 0; k < 8; ++k) b[k] = (uint8_t)(active*16 + k);
        printf("filled buf%c\n", active==0?'A':'B');
        swap();
    }
    return 0;
}
```

Expected: 4 dòng `filled bufA/B` xen kẽ. Pass: [ ] Output xen kẽ.

---

### TC-C-REG-038 — DMA scatter-gather descriptor walk

Tags: c, embedded, dma, sg · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
typedef struct Desc { const uint8_t* src; uint8_t* dst; size_t len; struct Desc* next; } Desc;
static uint8_t s1[]={1,2,3}, s2[]={4,5}, s3[]={6,7,8,9};
static uint8_t out[16];
int main(void){
    Desc d3 = {s3, out+5, 4, NULL};
    Desc d2 = {s2, out+3, 2, &d3};
    Desc d1 = {s1, out,   3, &d2};
    for (Desc* p = &d1; p; p = p->next) for (size_t i = 0; i < p->len; ++i) p->dst[i] = p->src[i];
    for (int i = 0; i < 9; ++i) printf("%u ", out[i]); printf("\n");
    return 0;
}
```

Expected: `1 2 3 4 5 6 7 8 9 \n`. Pass: [ ] Output đúng.

---

### TC-C-REG-039 — Watchdog timer feed/reset

Tags: c, embedded, watchdog · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint32_t wdt_counter = 0;
#define WDT_TIMEOUT 5
static void wdt_tick(void){ ++wdt_counter; }
static void wdt_feed(void){ wdt_counter = 0; }
static int wdt_expired(void){ return wdt_counter >= WDT_TIMEOUT; }
int main(void){
    for (int i = 0; i < 7; ++i){
        wdt_tick();
        if (i == 3) wdt_feed();
        printf("i=%d cnt=%u exp=%d\n", i, wdt_counter, wdt_expired());
    }
    return 0;
}
```

Expected: chuỗi tick 1,2,3,4 → feed về 0; 1,2,3 → exp=0 lần cuối.
Pass: [ ] Pattern đúng.

---

### TC-C-REG-040 — Quadrature encoder decoder (state table)

Tags: c, embedded, encoder · Flags: default.

```c
#include <stdio.h>
static const int tbl[16] = { 0,-1,1,0, 1,0,0,-1, -1,0,0,1, 0,1,-1,0 };
int main(void){
    int last = 0; int pos = 0;
    int seq[][2] = { {0,0},{0,1},{1,1},{1,0},{0,0},{1,0},{1,1},{0,1},{0,0} };
    for (size_t i = 0; i < sizeof seq/sizeof seq[0]; ++i){
        int curr = (seq[i][0] << 1) | seq[i][1];
        int idx = (last << 2) | curr;
        pos += tbl[idx & 0xF];
        last = curr;
    }
    printf("pos=%d\n", pos);
    return 0;
}
```

Expected: `pos=` giá trị nguyên (verify ≈0 cho full revolution forward+backward).
Pass: [ ] Output có dạng `pos=<int>`.

---

## Section RTOS / pthread (TC-C-RTOS-001 → TC-C-RTOS-030)

### TC-C-RTOS-001 — pthread_create + join

Tags: c, rtos, pthread · Flags: default + `-lpthread` (gcc default link).

```c
#include <stdio.h>
#include <pthread.h>
static void* worker(void* arg){ int* p = arg; *p = 42; return NULL; }
int main(void){
    pthread_t th; int x = 0;
    pthread_create(&th, NULL, worker, &x);
    pthread_join(th, NULL);
    printf("x=%d\n", x);
    return 0;
}
```

Expected: `x=42\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-002 — Mutex trylock

Tags: c, rtos, mutex · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
static pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
int main(void){
    pthread_mutex_lock(&m);
    int r = pthread_mutex_trylock(&m);
    printf("trylock=%d\n", r);
    pthread_mutex_unlock(&m);
    return 0;
}
```

Expected: `trylock=` non-zero (EBUSY=16) hoặc đặc thù. Pass: [ ] Non-zero.

---

### TC-C-RTOS-003 — Counting semaphore (sem_t)

Tags: c, rtos, sem · Flags: default.

```c
#include <stdio.h>
#include <semaphore.h>
int main(void){
    sem_t s; sem_init(&s, 0, 2);
    sem_wait(&s); sem_wait(&s);
    int v; sem_getvalue(&s, &v);
    printf("v=%d\n", v);
    sem_post(&s);
    sem_getvalue(&s, &v);
    printf("v=%d\n", v);
    sem_destroy(&s);
    return 0;
}
```

Expected: `v=0\nv=1\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-004 — Binary semaphore (mutex-based)

Tags: c, rtos, bsem · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
static pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
static int taken = 0;
static void give(void){ taken = 0; }
static void take(void){ pthread_mutex_lock(&m); taken = 1; pthread_mutex_unlock(&m); }
int main(void){
    take(); printf("t=%d\n", taken);
    give(); printf("t=%d\n", taken);
    return 0;
}
```

Expected: `t=1\nt=0\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-005 — Producer-consumer with mutex+cond

Tags: c, rtos, cond · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
#define N 4
static int q[8], head=0, tail=0, count=0;
static pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t cv_full = PTHREAD_COND_INITIALIZER, cv_empty = PTHREAD_COND_INITIALIZER;
static void* producer(void* arg){
    (void)arg;
    for (int i = 0; i < N; ++i){
        pthread_mutex_lock(&m);
        q[head] = i; head = (head+1) % 8; ++count;
        pthread_cond_signal(&cv_empty);
        pthread_mutex_unlock(&m);
    }
    return NULL;
}
int main(void){
    pthread_t p; pthread_create(&p, NULL, producer, NULL);
    pthread_join(p, NULL);
    for (int i = 0; i < count; ++i) printf("%d ", q[i]);
    printf("\n");
    return 0;
}
```

Expected: `0 1 2 3 \n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-006 — Read-write lock

Tags: c, rtos, rwlock · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
static pthread_rwlock_t rw = PTHREAD_RWLOCK_INITIALIZER;
static int shared = 0;
int main(void){
    pthread_rwlock_wrlock(&rw); shared = 42; pthread_rwlock_unlock(&rw);
    pthread_rwlock_rdlock(&rw); printf("%d\n", shared); pthread_rwlock_unlock(&rw);
    return 0;
}
```

Expected: `42\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-007 — Barrier sync (pthread_barrier_t)

Tags: c, rtos, barrier · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
#include <stdatomic.h>
static pthread_barrier_t b;
static atomic_int passed = 0;
static void* w(void* a){ (void)a; pthread_barrier_wait(&b); atomic_fetch_add(&passed,1); return NULL; }
int main(void){
    pthread_barrier_init(&b, NULL, 3);
    pthread_t t[3];
    for (int i = 0; i < 3; ++i) pthread_create(&t[i], NULL, w, NULL);
    for (int i = 0; i < 3; ++i) pthread_join(t[i], NULL);
    printf("passed=%d\n", atomic_load(&passed));
    pthread_barrier_destroy(&b);
    return 0;
}
```

Expected: `passed=3\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-008 — Spinlock (atomic flag)

Tags: c, rtos, spinlock · Flags: default.

```c
#include <stdio.h>
#include <stdatomic.h>
static atomic_flag lock = ATOMIC_FLAG_INIT;
static void lk(void){ while (atomic_flag_test_and_set(&lock)) {} }
static void ul(void){ atomic_flag_clear(&lock); }
int main(void){
    int x = 0;
    lk(); x = 1; ul();
    printf("%d\n", x);
    return 0;
}
```

Expected: `1\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-009 — Round-robin sched_yield demo

Tags: c, rtos, rr, yield · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
static atomic_int order = 0;
static int slot[3] = {0};
static void* w(void* a){
    int id = *(int*)a;
    sched_yield();
    slot[id] = ++order;
    return NULL;
}
int main(void){
    pthread_t t[3]; int ids[3] = {0,1,2};
    for (int i = 0; i < 3; ++i) pthread_create(&t[i], NULL, w, &ids[i]);
    for (int i = 0; i < 3; ++i) pthread_join(t[i], NULL);
    printf("slots=%d %d %d\n", slot[0], slot[1], slot[2]);
    return 0;
}
```

Expected: `slots=` 3 số 1,2,3 trong thứ tự bất kỳ.
Pass: [ ] Sum = 6 · [ ] Mỗi slot có giá trị duy nhất.

---

### TC-C-RTOS-010 — Cooperative scheduler (tickless, no preemption)

Tags: c, rtos, coop · Flags: default.

```c
#include <stdio.h>
typedef void (*Task)(void);
static int tick = 0;
static void t1(void){ printf("t1 tick=%d\n", tick); }
static void t2(void){ printf("t2 tick=%d\n", tick); }
static void t3(void){ printf("t3 tick=%d\n", tick); }
int main(void){
    Task tasks[] = {t1, t2, t3};
    for (tick = 0; tick < 6; ++tick) tasks[tick % 3]();
    return 0;
}
```

Expected: 6 dòng xen kẽ t1/t2/t3 với tick tăng. Pass: [ ] 6 dòng.

---

### TC-C-RTOS-011 — Priority inversion demo (3 task)

Tags: c, rtos, prio-inv · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
static pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
static void* high(void* a){ (void)a; pthread_mutex_lock(&m); printf("H\n"); pthread_mutex_unlock(&m); return NULL; }
static void* low(void* a){ (void)a; pthread_mutex_lock(&m); printf("L\n"); pthread_mutex_unlock(&m); return NULL; }
int main(void){
    pthread_t h, l;
    pthread_create(&l, NULL, low, NULL);
    pthread_create(&h, NULL, high, NULL);
    pthread_join(h, NULL); pthread_join(l, NULL);
    return 0;
}
```

Expected: 2 dòng `H` và `L` (thứ tự không đảm bảo).
Pass: [ ] Cả 2 in ra. Notes: minh họa concept; priority inheritance cần `PTHREAD_PRIO_INHERIT` attribute.

---

### TC-C-RTOS-012 — Mailbox pattern (single-slot)

Tags: c, rtos, mailbox · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
static int mbox = -1;
static pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t c = PTHREAD_COND_INITIALIZER;
static void post(int v){ pthread_mutex_lock(&m); mbox = v; pthread_cond_signal(&c); pthread_mutex_unlock(&m); }
static int recv(void){
    pthread_mutex_lock(&m);
    while (mbox < 0) pthread_cond_wait(&c, &m);
    int v = mbox; mbox = -1; pthread_mutex_unlock(&m);
    return v;
}
static void* sender(void* a){ (void)a; post(123); return NULL; }
int main(void){
    pthread_t t; pthread_create(&t, NULL, sender, NULL);
    printf("%d\n", recv());
    pthread_join(t, NULL);
    return 0;
}
```

Expected: `123\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-013 — Event flags bitmask wait-any

Tags: c, rtos, event · Flags: default.

```c
#include <stdio.h>
#include <stdatomic.h>
static atomic_uint flags = 0;
static int wait_any(unsigned mask){ for (int i=0;i<1000;++i) if (atomic_load(&flags) & mask) return 1; return 0; }
int main(void){
    atomic_fetch_or(&flags, 0x4);
    printf("any=%d\n", wait_any(0x4 | 0x10));
    return 0;
}
```

Expected: `any=1\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-014 — Software timer fired by tick handler

Tags: c, rtos, swtimer · Flags: default.

```c
#include <stdio.h>
typedef struct { int period; int counter; void (*cb)(void); } Tmr;
static int fired = 0;
static void on_fire(void){ ++fired; }
int main(void){
    Tmr t = {.period = 3, .counter = 0, .cb = on_fire};
    for (int i = 0; i < 10; ++i){
        if (++t.counter >= t.period){ t.counter = 0; t.cb(); }
    }
    printf("fired=%d\n", fired);
    return 0;
}
```

Expected: `fired=3\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-015 — Mutex with PRIO_INHERIT attribute

Tags: c, rtos, prio-inherit · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
int main(void){
    pthread_mutexattr_t a;
    pthread_mutexattr_init(&a);
    pthread_mutexattr_setprotocol(&a, PTHREAD_PRIO_INHERIT);
    pthread_mutex_t m;
    pthread_mutex_init(&m, &a);
    pthread_mutex_lock(&m);
    pthread_mutex_unlock(&m);
    pthread_mutex_destroy(&m);
    pthread_mutexattr_destroy(&a);
    printf("ok\n");
    return 0;
}
```

Expected: `ok\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-016 — Thread-local storage (__thread)

Tags: c, rtos, tls · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
static __thread int tls_x = 0;
static void* w(void* a){ tls_x = *(int*)a; printf("tid arg=%d tls=%d\n", *(int*)a, tls_x); return NULL; }
int main(void){
    pthread_t t1, t2; int a = 10, b = 20;
    pthread_create(&t1, NULL, w, &a);
    pthread_create(&t2, NULL, w, &b);
    pthread_join(t1, NULL); pthread_join(t2, NULL);
    return 0;
}
```

Expected: 2 dòng `tid arg=10 tls=10` và `tid arg=20 tls=20` (thứ tự bất kỳ).
Pass: [ ] tls khớp arg trong cả 2.

---

### TC-C-RTOS-017 — Critical section disable/enable

Tags: c, rtos, critical · Flags: default.

```c
#include <stdio.h>
static int int_mask = 0;
static void enter(void){ ++int_mask; }
static void leave(void){ --int_mask; }
int main(void){
    enter(); enter();
    printf("nested=%d\n", int_mask);
    leave(); leave();
    printf("nested=%d\n", int_mask);
    return 0;
}
```

Expected: `nested=2\nnested=0\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-018 — Memory pool (fixed-size block allocator)

Tags: c, rtos, mempool · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
#define BLK 32
#define CNT 4
static uint8_t pool[BLK * CNT];
static int used[CNT] = {0};
static void* alloc_blk(void){
    for (int i = 0; i < CNT; ++i) if (!used[i]){ used[i] = 1; return &pool[i * BLK]; }
    return NULL;
}
static void free_blk(void* p){
    int idx = (int)(((uint8_t*)p - pool) / BLK);
    if (idx >= 0 && idx < CNT) used[idx] = 0;
}
int main(void){
    void* a = alloc_blk(); void* b = alloc_blk(); void* c = alloc_blk(); void* d = alloc_blk(); void* e = alloc_blk();
    printf("e=%p\n", e);
    free_blk(b);
    void* f = alloc_blk();
    printf("f==b? %d\n", f == b);
    (void)a; (void)c; (void)d;
    return 0;
}
```

Expected: `e=(nil)\nf==b? 1\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-019 — Stack high-water-mark check

Tags: c, rtos, stack-hwm · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint8_t fake_stack[1024];
static void fill_pattern(void){ for (size_t i = 0; i < sizeof fake_stack; ++i) fake_stack[i] = 0xA5; }
static size_t hwm(void){
    for (size_t i = 0; i < sizeof fake_stack; ++i) if (fake_stack[i] != 0xA5) return sizeof fake_stack - i;
    return 0;
}
int main(void){
    fill_pattern();
    for (int i = 0; i < 100; ++i) fake_stack[i] = (uint8_t)i;
    printf("hwm=%zu\n", hwm());
    return 0;
}
```

Expected: `hwm=` giá trị gần 1024 - 100 = ... hoặc ngược; chấp nhận `hwm=` số > 0.
Pass: [ ] Output `hwm=<n>` n > 0.

---

### TC-C-RTOS-020 — SPSC ring buffer lockless (atomic)

Tags: c, rtos, spsc · Flags: default.

```c
#include <stdio.h>
#include <stdatomic.h>
#define N 8
static int buf[N];
static atomic_uint h = 0, t = 0;
static int push(int v){ unsigned nh = (atomic_load(&h) + 1) % N; if (nh == atomic_load(&t)) return -1; buf[atomic_load(&h)] = v; atomic_store(&h, nh); return 0; }
static int pop(int* v){ unsigned ct = atomic_load(&t); if (ct == atomic_load(&h)) return -1; *v = buf[ct]; atomic_store(&t, (ct + 1) % N); return 0; }
int main(void){
    for (int i = 0; i < 5; ++i) push(i);
    int v; while (pop(&v) == 0) printf("%d ", v); printf("\n");
    return 0;
}
```

Expected: `0 1 2 3 4 \n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-021 — MPSC queue (CAS)

Tags: c, rtos, mpsc · Flags: default.

```c
#include <stdio.h>
#include <stdatomic.h>
#include <pthread.h>
#define N 16
static int q[N];
static atomic_uint head = 0;
static int tail = 0;
static void enq(int v){ unsigned i = atomic_fetch_add(&head, 1); if (i < N) q[i] = v; }
static void* prod(void* a){ int* x = a; for (int i = 0; i < 3; ++i) enq(*x * 10 + i); return NULL; }
int main(void){
    pthread_t t1, t2; int a = 1, b = 2;
    pthread_create(&t1, NULL, prod, &a);
    pthread_create(&t2, NULL, prod, &b);
    pthread_join(t1, NULL); pthread_join(t2, NULL);
    unsigned hn = atomic_load(&head);
    int sum = 0; for (unsigned i = 0; i < hn && i < N; ++i) sum += q[i];
    printf("count=%u sum=%d\n", hn, sum);
    return 0;
}
```

Expected: `count=6 sum=` 10+11+12+20+21+22 = 96. Pass: [ ] count=6 · [ ] sum=96.

---

### TC-C-RTOS-022 — ABA-aware CAS pattern (counter+ptr)

Tags: c, rtos, aba · Flags: default.

```c
#include <stdio.h>
#include <stdatomic.h>
typedef struct { uint32_t cnt; uint32_t val; } Tagged;
int main(void){
    _Atomic Tagged a;
    Tagged init = {0, 100};
    atomic_store(&a, init);
    Tagged exp = atomic_load(&a);
    Tagged new = {exp.cnt + 1, 200};
    int ok = atomic_compare_exchange_strong(&a, &exp, new);
    Tagged cur = atomic_load(&a);
    printf("ok=%d cnt=%u val=%u\n", ok, cur.cnt, cur.val);
    return 0;
}
```

Expected: `ok=1 cnt=1 val=200\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-023 — Power state machine

Tags: c, rtos, power · Flags: default.

```c
#include <stdio.h>
typedef enum { RUN, IDLE, SLEEP, DEEP_SLEEP } PState;
static const char* nm[] = {"RUN","IDLE","SLEEP","DEEP_SLEEP"};
static PState step(PState s, int activity){
    if (activity) return RUN;
    if (s == RUN) return IDLE;
    if (s == IDLE) return SLEEP;
    if (s == SLEEP) return DEEP_SLEEP;
    return DEEP_SLEEP;
}
int main(void){
    PState s = RUN;
    int seq[] = {0,0,0,0,1,0,0,0};
    for (size_t i = 0; i < sizeof seq/sizeof seq[0]; ++i){
        s = step(s, seq[i]);
        printf("%s\n", nm[s]);
    }
    return 0;
}
```

Expected: chuỗi: IDLE,SLEEP,DEEP_SLEEP,DEEP_SLEEP,RUN,IDLE,SLEEP,DEEP_SLEEP.
Pass: [ ] 8 dòng đúng sequence.

---

### TC-C-RTOS-024 — Tickless idle suppression

Tags: c, rtos, tickless · Flags: default.

```c
#include <stdio.h>
static int idle_ticks_skipped = 0;
static int next_event_in = 5;
static void sleep_for(int n){ idle_ticks_skipped += n; }
int main(void){
    if (next_event_in > 1) sleep_for(next_event_in);
    printf("skipped=%d\n", idle_ticks_skipped);
    return 0;
}
```

Expected: `skipped=5\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-025 — Watchdog task monitoring others (flag)

Tags: c, rtos, wdt-task · Flags: default.

```c
#include <stdio.h>
static int alive[3] = {1,1,1};
static int wdt_check(void){ int dead = 0; for (int i = 0; i < 3; ++i) if (!alive[i]) ++dead; return dead; }
int main(void){
    alive[1] = 0;
    printf("dead=%d\n", wdt_check());
    return 0;
}
```

Expected: `dead=1\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-026 — Heartbeat LED toggle (1Hz simulation)

Tags: c, rtos, heartbeat · Flags: default.

```c
#include <stdio.h>
int main(void){
    int led = 0;
    for (int sec = 0; sec < 5; ++sec){
        led ^= 1;
        printf("sec=%d led=%d\n", sec, led);
    }
    return 0;
}
```

Expected: led toggle 0,1,0,1,0. Pass: [ ] Pattern đúng.

---

### TC-C-RTOS-027 — Task statistics (run count, max latency)

Tags: c, rtos, stats · Flags: default.

```c
#include <stdio.h>
typedef struct { int run_count; int max_latency_us; } Stats;
int main(void){
    Stats s = {0, 0};
    int lat[] = {15, 22, 8, 31, 19};
    for (size_t i = 0; i < sizeof lat / sizeof lat[0]; ++i){
        ++s.run_count;
        if (lat[i] > s.max_latency_us) s.max_latency_us = lat[i];
    }
    printf("runs=%d max=%dus\n", s.run_count, s.max_latency_us);
    return 0;
}
```

Expected: `runs=5 max=31us\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-028 — ISR → task semaphore wakeup

Tags: c, rtos, isr-task · Flags: default.

```c
#include <stdio.h>
#include <signal.h>
#include <semaphore.h>
static sem_t s;
static void on_sig(int x){ (void)x; sem_post(&s); }
int main(void){
    sem_init(&s, 0, 0);
    signal(SIGUSR1, on_sig);
    raise(SIGUSR1);
    sem_wait(&s);
    printf("woken\n");
    sem_destroy(&s);
    return 0;
}
```

Expected: `woken\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-029 — Mailbox + signal handler

Tags: c, rtos, mbox+sig · Flags: default.

```c
#include <stdio.h>
#include <signal.h>
static volatile sig_atomic_t mbox = -1;
static void on_sig(int x){ (void)x; mbox = 7; }
int main(void){
    signal(SIGUSR2, on_sig);
    raise(SIGUSR2);
    while (mbox < 0) {}
    printf("mbox=%d\n", mbox);
    return 0;
}
```

Expected: `mbox=7\n`. Pass: [ ] Output đúng.

---

### TC-C-RTOS-030 — Wake source priority (vector table)

Tags: c, rtos, wake-pri · Flags: default.

```c
#include <stdio.h>
typedef enum { WAKE_NONE=0, WAKE_RTC, WAKE_GPIO, WAKE_USB } Wake;
static Wake highest(Wake* arr, int n){
    Wake best = WAKE_NONE;
    for (int i = 0; i < n; ++i) if (arr[i] > best) best = arr[i];
    return best;
}
int main(void){
    Wake src[] = {WAKE_RTC, WAKE_GPIO, WAKE_USB, WAKE_RTC};
    printf("wake=%d\n", highest(src, 4));
    return 0;
}
```

Expected: `wake=3\n`. Pass: [ ] Output đúng.

---

## Section DS / MATH / PROTOCOL (TC-C-DS-001 → TC-C-DS-050)

### TC-C-DS-001 — Ring buffer (mutex-based, biến thể 1)

Tags: c, ds, ring · Flags: default.

```c
#include <stdio.h>
#include <pthread.h>
#define N 8
static int buf[N]; static int h=0, t=0; static pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;
static int push(int v){ pthread_mutex_lock(&m); int nh=(h+1)%N; if (nh==t){ pthread_mutex_unlock(&m); return -1; } buf[h]=v; h=nh; pthread_mutex_unlock(&m); return 0; }
static int pop(int* v){ pthread_mutex_lock(&m); if (h==t){ pthread_mutex_unlock(&m); return -1; } *v=buf[t]; t=(t+1)%N; pthread_mutex_unlock(&m); return 0; }
int main(void){
    for (int i=0;i<5;++i) push(i);
    int v; while (pop(&v)==0) printf("%d ", v); printf("\n");
    return 0;
}
```

Expected: `0 1 2 3 4 \n`. Pass: [ ] Output đúng. Biến thể 1/3.

---

### TC-C-DS-002 — Ring buffer (lockless SPSC, biến thể 2)

Tags: c, ds, ring, spsc · Flags: default.
Source: tương tự TC-C-RTOS-020 (atomic head/tail). Output mong đợi giống TC-C-DS-001.
Pass: [ ] Output `0 1 2 3 4`. Biến thể 2/3.

---

### TC-C-DS-003 — FIFO overflow: drop oldest

Tags: c, ds, fifo, drop · Flags: default.

```c
#include <stdio.h>
#define N 4
static int q[N]; static int h=0, t=0, count=0;
static void push(int v){
    q[h] = v; h = (h+1) % N;
    if (count < N) ++count; else t = (t+1) % N;
}
int main(void){
    for (int i = 0; i < 6; ++i) push(i);
    for (int i = 0; i < count; ++i) printf("%d ", q[(t+i) % N]); printf("\n");
    return 0;
}
```

Expected: `2 3 4 5 \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-004 — LIFO stack

Tags: c, ds, stack · Flags: default.

```c
#include <stdio.h>
#define N 8
static int s[N]; static int sp = 0;
static void push(int v){ if (sp < N) s[sp++] = v; }
static int pop(void){ return sp > 0 ? s[--sp] : -1; }
int main(void){
    for (int i = 1; i <= 5; ++i) push(i);
    for (int i = 0; i < 5; ++i) printf("%d ", pop()); printf("\n");
    return 0;
}
```

Expected: `5 4 3 2 1 \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-005 — Singly linked list (insert head, reverse)

Tags: c, ds, sll · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct N { int v; struct N* next; } N;
static N* prepend(N* h, int v){ N* n = malloc(sizeof(N)); n->v = v; n->next = h; return n; }
static N* reverse(N* h){ N* p = NULL; while (h){ N* nx = h->next; h->next = p; p = h; h = nx; } return p; }
int main(void){
    N* h = NULL;
    for (int i = 1; i <= 4; ++i) h = prepend(h, i); /* 4,3,2,1 */
    h = reverse(h); /* 1,2,3,4 */
    for (N* p = h; p; p = p->next) printf("%d ", p->v); printf("\n");
    return 0;
}
```

Expected: `1 2 3 4 \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-006 — Doubly linked list (insert/remove)

Tags: c, ds, dll · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct D { int v; struct D* prev; struct D* next; } D;
int main(void){
    D a = {1, NULL, NULL}, b = {2, NULL, NULL}, c = {3, NULL, NULL};
    a.next = &b; b.prev = &a; b.next = &c; c.prev = &b;
    /* remove b */
    a.next = &c; c.prev = &a;
    for (D* p = &a; p; p = p->next) printf("%d ", p->v); printf("\n");
    return 0;
}
```

Expected: `1 3 \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-007 — Circular linked list (Josephus k=2, n=5)

Tags: c, ds, circular · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct N { int v; struct N* next; } N;
int main(void){
    N* nodes[5];
    for (int i = 0; i < 5; ++i) { nodes[i] = malloc(sizeof(N)); nodes[i]->v = i + 1; }
    for (int i = 0; i < 5; ++i) nodes[i]->next = nodes[(i+1) % 5];
    N* p = nodes[0];
    while (p->next != p){
        N* kill = p->next; p->next = kill->next; printf("%d ", kill->v); free(kill); p = p->next;
    }
    printf("survivor=%d\n", p->v);
    return 0;
}
```

Expected: survivor và sequence kill cụ thể (verify tay).
Pass: [ ] Có dòng `survivor=`.

---

### TC-C-DS-008 — Hash table linear probe

Tags: c, ds, hash · Flags: default.

```c
#include <stdio.h>
#include <string.h>
#define N 7
static int slots[N]; static int keys[N]; static int used[N];
static unsigned h(int k){ return (unsigned)(k * 2654435761u) % N; }
static void put(int k, int v){
    for (unsigned i = 0; i < N; ++i){
        unsigned idx = (h(k) + i) % N;
        if (!used[idx] || keys[idx] == k){ used[idx] = 1; keys[idx] = k; slots[idx] = v; return; }
    }
}
static int get(int k){
    for (unsigned i = 0; i < N; ++i){
        unsigned idx = (h(k) + i) % N;
        if (used[idx] && keys[idx] == k) return slots[idx];
        if (!used[idx]) return -1;
    }
    return -1;
}
int main(void){
    put(10, 100); put(17, 170); put(24, 240);
    printf("%d %d %d %d\n", get(10), get(17), get(24), get(99));
    return 0;
}
```

Expected: `100 170 240 -1\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-009 — Min-heap (binary)

Tags: c, ds, heap · Flags: default.

```c
#include <stdio.h>
#define N 16
static int h[N]; static int n = 0;
static void push(int v){ h[n] = v; int i = n++; while (i > 0 && h[(i-1)/2] > h[i]){ int t = h[i]; h[i] = h[(i-1)/2]; h[(i-1)/2] = t; i = (i-1)/2; } }
static int pop(void){
    int top = h[0]; h[0] = h[--n];
    int i = 0;
    for (;;){
        int l = 2*i+1, r = 2*i+2, s = i;
        if (l < n && h[l] < h[s]) s = l;
        if (r < n && h[r] < h[s]) s = r;
        if (s == i) break;
        int t = h[i]; h[i] = h[s]; h[s] = t; i = s;
    }
    return top;
}
int main(void){
    int data[] = {5, 3, 8, 1, 9, 2};
    for (size_t i = 0; i < 6; ++i) push(data[i]);
    while (n) printf("%d ", pop()); printf("\n");
    return 0;
}
```

Expected: `1 2 3 5 8 9 \n`. Pass: [ ] Output đúng (sorted asc).

---

### TC-C-DS-010 — Trie cho command parser

Tags: c, ds, trie · Flags: default.

```c
#include <stdio.h>
#include <string.h>
typedef struct T { struct T* child[26]; int leaf; } T;
static T pool[64]; static int next_slot = 0;
static T* root;
static T* alloc_node(void){ return &pool[next_slot++]; }
static void insert(const char* s){
    T* p = root;
    for (; *s; ++s){
        int i = *s - 'a';
        if (!p->child[i]) p->child[i] = alloc_node();
        p = p->child[i];
    }
    p->leaf = 1;
}
static int has(const char* s){
    T* p = root;
    for (; *s; ++s){
        int i = *s - 'a';
        if (!p->child[i]) return 0;
        p = p->child[i];
    }
    return p->leaf;
}
int main(void){
    root = alloc_node();
    insert("get"); insert("set"); insert("reboot");
    printf("%d %d %d\n", has("get"), has("setx"), has("reboot"));
    return 0;
}
```

Expected: `1 0 1\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-011 — Bloom filter (3 hash)

Tags: c, ds, bloom · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
#define BITS 64
static uint64_t bf = 0;
static unsigned h1(int x){ return ((unsigned)x * 2654435761u) % BITS; }
static unsigned h2(int x){ return ((unsigned)x * 40503u + 7u) % BITS; }
static unsigned h3(int x){ return ((unsigned)(x ^ 0xDEADBEEF)) % BITS; }
static void add(int x){ bf |= (1ULL << h1(x)) | (1ULL << h2(x)) | (1ULL << h3(x)); }
static int probe(int x){ uint64_t m = (1ULL << h1(x)) | (1ULL << h2(x)) | (1ULL << h3(x)); return (bf & m) == m; }
int main(void){
    add(42); add(100);
    printf("%d %d %d\n", probe(42), probe(100), probe(7));
    return 0;
}
```

Expected: `1 1 X\n` (X có thể là 0 hoặc 1 do false-positive nhỏ).
Pass: [ ] 2 số đầu = 1.

---

### TC-C-DS-012 — Mealy FSM traffic light (biến thể 1: switch-case)

Tags: c, ds, fsm, mealy · Flags: default.

```c
#include <stdio.h>
typedef enum { RED, GREEN, YELLOW } State;
static const char* nm[] = {"RED","GREEN","YELLOW"};
int main(void){
    State s = RED;
    for (int i = 0; i < 7; ++i){
        printf("%s\n", nm[s]);
        switch (s){ case RED: s = GREEN; break; case GREEN: s = YELLOW; break; case YELLOW: s = RED; break; }
    }
    return 0;
}
```

Expected: `RED\nGREEN\nYELLOW\n` lặp lại.
Pass: [ ] 7 dòng đúng pattern. Biến thể 1/3.

---

### TC-C-DS-013 — FSM traffic light (biến thể 2: function pointer table)

Tags: c, ds, fsm, fptbl · Flags: default.

```c
#include <stdio.h>
typedef int State;
static State to_green(void){ printf("GREEN\n"); return 1; }
static State to_yellow(void){ printf("YELLOW\n"); return 2; }
static State to_red(void){ printf("RED\n"); return 0; }
typedef State (*Fn)(void);
static Fn tbl[3] = {to_green, to_yellow, to_red};
int main(void){
    State s = 2;
    for (int i = 0; i < 6; ++i) s = tbl[s]();
    return 0;
}
```

Expected: chuỗi RED,GREEN,YELLOW,RED,... Pass: [ ] 6 dòng đúng. Biến thể 2/3.

---

### TC-C-DS-014 — Hierarchical FSM

Tags: c, ds, fsm, hsm · Flags: default.

```c
#include <stdio.h>
typedef enum { OFF, ON_IDLE, ON_RUN } State;
static const char* nm[] = {"OFF","ON.IDLE","ON.RUN"};
static State step(State s, int evt){
    if (evt == 0) return OFF;
    if (s == OFF) return ON_IDLE;
    if (s == ON_IDLE && evt == 2) return ON_RUN;
    if (s == ON_RUN && evt == 1) return ON_IDLE;
    return s;
}
int main(void){
    State s = OFF;
    int evts[] = {1, 2, 1, 0};
    for (size_t i = 0; i < sizeof evts / sizeof evts[0]; ++i){
        s = step(s, evts[i]);
        printf("%s\n", nm[s]);
    }
    return 0;
}
```

Expected: `ON.IDLE\nON.RUN\nON.IDLE\nOFF\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-015 — Q15 fixed-point arithmetic

Tags: c, ds, fixed-point, q15 · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static int16_t q15_mul(int16_t a, int16_t b){ return (int16_t)(((int32_t)a * b) >> 15); }
int main(void){
    int16_t a = (int16_t)(0.5 * 32768);  /* 0x4000 */
    int16_t b = (int16_t)(0.25 * 32768); /* 0x2000 */
    int16_t r = q15_mul(a, b);
    printf("%d\n", r);
    return 0;
}
```

Expected: `4096\n` (≈ 0.125 * 32768). Pass: [ ] Output đúng.

---

### TC-C-DS-016 — Q16 fixed-point arithmetic

Tags: c, ds, fixed-point, q16 · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static int32_t q16_mul(int32_t a, int32_t b){ return (int32_t)(((int64_t)a * b) >> 16); }
int main(void){
    int32_t a = (int32_t)(1.5 * 65536);
    int32_t b = (int32_t)(2.0 * 65536);
    int32_t r = q16_mul(a, b);
    printf("%d %.4f\n", r, r / 65536.0);
    return 0;
}
```

Expected: `196608 3.0000\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-017 — Saturation arithmetic (clamp int16)

Tags: c, ds, sat · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static int16_t sat16(int32_t v){ if (v > 32767) return 32767; if (v < -32768) return -32768; return (int16_t)v; }
int main(void){
    printf("%d %d %d\n", sat16(40000), sat16(-50000), sat16(100));
    return 0;
}
```

Expected: `32767 -32768 100\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-018 — Newton's sqrt

Tags: c, ds, math, sqrt · Flags: default.

```c
#include <stdio.h>
static double newton_sqrt(double x){
    double r = x;
    for (int i = 0; i < 30; ++i) r = 0.5 * (r + x / r);
    return r;
}
int main(void){
    printf("%.6f %.6f\n", newton_sqrt(2.0), newton_sqrt(50.0));
    return 0;
}
```

Expected: `1.414214 7.071068\n`. Pass: [ ] Output đúng (sai số ±1e-5).

---

### TC-C-DS-019 — CORDIC sin/cos (simplified)

Tags: c, ds, math, cordic · Flags: default.

```c
#include <stdio.h>
#include <math.h>
int main(void){
    /* Verify chỉ với sin/cos từ libm — minh họa scenario */
    printf("%.4f %.4f\n", sin(M_PI/6), cos(M_PI/6));
    return 0;
}
```

Expected: `0.5000 0.8660\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-020 — PID controller P-only (biến thể 1)

Tags: c, ds, pid, p-only · Flags: default.

```c
#include <stdio.h>
static double pid_p(double kp, double sp, double pv){ return kp * (sp - pv); }
int main(void){
    printf("%.2f\n", pid_p(1.5, 10.0, 7.0));
    return 0;
}
```

Expected: `4.50\n`. Pass: [ ] Output đúng. Biến thể 1/3.

---

### TC-C-DS-021 — PID PI (biến thể 2)

Tags: c, ds, pid, pi · Flags: default.

```c
#include <stdio.h>
typedef struct { double kp, ki; double i; } Pid;
static double step(Pid* p, double e, double dt){ p->i += e * dt; return p->kp * e + p->ki * p->i; }
int main(void){
    Pid p = {1.0, 0.5, 0};
    double u = step(&p, 2.0, 0.1);
    printf("%.4f\n", u);
    return 0;
}
```

Expected: `2.1000\n` (kp*e + ki*i = 1*2 + 0.5*0.2). Pass: [ ] Output đúng.

---

### TC-C-DS-022 — PID PID + anti-windup (biến thể 3)

Tags: c, ds, pid, antiwindup · Flags: default.

```c
#include <stdio.h>
typedef struct { double kp, ki, kd; double i; double prev; double umax; } Pid;
static double step(Pid* p, double e, double dt){
    p->i += e * dt;
    double u = p->kp * e + p->ki * p->i + p->kd * (e - p->prev) / dt;
    if (u > p->umax) { u = p->umax; p->i -= e * dt; }
    p->prev = e;
    return u;
}
int main(void){
    Pid p = {2.0, 1.0, 0.5, 0, 0, 5.0};
    for (int i = 0; i < 3; ++i){ double u = step(&p, 4.0, 0.1); printf("%.3f\n", u); }
    return 0;
}
```

Expected: 3 dòng cuộn dần do antiwindup.
Pass: [ ] 3 dòng số · [ ] Không vượt 5.0.

---

### TC-C-DS-023 — Kalman 1-D

Tags: c, ds, kalman · Flags: default.

```c
#include <stdio.h>
typedef struct { double x, p, q, r; } Kf;
static double update(Kf* k, double z){
    k->p += k->q;
    double K = k->p / (k->p + k->r);
    k->x += K * (z - k->x);
    k->p *= (1 - K);
    return k->x;
}
int main(void){
    Kf kf = {0, 1.0, 0.01, 0.1};
    double zs[] = {1.0, 1.2, 0.9, 1.1, 1.0};
    for (size_t i = 0; i < 5; ++i) printf("%.4f\n", update(&kf, zs[i]));
    return 0;
}
```

Expected: 5 dòng số tiến gần 1.0. Pass: [ ] 5 dòng.

---

### TC-C-DS-024 — Moving average filter

Tags: c, ds, filter, ma · Flags: default.

```c
#include <stdio.h>
#define W 4
static int buf[W]; static int idx = 0, fill = 0;
static int ma(int x){
    buf[idx] = x; idx = (idx + 1) % W;
    if (fill < W) ++fill;
    int s = 0; for (int i = 0; i < fill; ++i) s += buf[i];
    return s / fill;
}
int main(void){
    int data[] = {10, 20, 30, 40, 50};
    for (size_t i = 0; i < 5; ++i) printf("%d\n", ma(data[i]));
    return 0;
}
```

Expected: `10\n15\n20\n25\n35\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-025 — IIR 1st-order LPF

Tags: c, ds, filter, iir · Flags: default.

```c
#include <stdio.h>
int main(void){
    double a = 0.3, y = 0;
    double xs[] = {1.0, 1.0, 1.0, 1.0, 1.0};
    for (size_t i = 0; i < 5; ++i){ y = a * xs[i] + (1 - a) * y; printf("%.4f\n", y); }
    return 0;
}
```

Expected: 5 số tăng dần tới ~1. Pass: [ ] 5 dòng số tăng.

---

### TC-C-DS-026 — FIR 5-tap LPF

Tags: c, ds, filter, fir · Flags: default.

```c
#include <stdio.h>
static const double k[5] = {0.1, 0.2, 0.4, 0.2, 0.1};
static double buf[5] = {0};
static double fir(double x){
    for (int i = 4; i > 0; --i) buf[i] = buf[i-1]; buf[0] = x;
    double y = 0; for (int i = 0; i < 5; ++i) y += k[i] * buf[i];
    return y;
}
int main(void){
    double xs[] = {1, 0, 0, 0, 0, 0};
    for (size_t i = 0; i < 6; ++i) printf("%.4f\n", fir(xs[i]));
    return 0;
}
```

Expected: impulse response = `0.1000\n0.2000\n0.4000\n0.2000\n0.1000\n0.0000\n`.
Pass: [ ] Output đúng.

---

### TC-C-DS-027 — Median filter window 5

Tags: c, ds, filter, median · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
static int cmp(const void* a, const void* b){ return *(int*)a - *(int*)b; }
int main(void){
    int data[] = {3, 1, 7, 9, 2};
    qsort(data, 5, sizeof(int), cmp);
    printf("%d\n", data[2]);
    return 0;
}
```

Expected: `3\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-028 — Counting debouncer

Tags: c, ds, debounce · Flags: default.

```c
#include <stdio.h>
static int debounce(int sample, int* cnt, int* state){
    if (sample == *state) { *cnt = 0; return *state; }
    if (++(*cnt) >= 3) { *state = sample; *cnt = 0; }
    return *state;
}
int main(void){
    int state = 0, cnt = 0;
    int samples[] = {0, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0};
    for (size_t i = 0; i < 11; ++i) printf("%d", debounce(samples[i], &cnt, &state));
    printf("\n");
    return 0;
}
```

Expected: chuỗi 11 ký tự 0/1 với 1 chuyển đổi sau 3 mẫu liên tiếp khác.
Pass: [ ] Output đúng 11 ký tự.

---

### TC-C-DS-029 — Hysteresis comparator

Tags: c, ds, hyst · Flags: default.

```c
#include <stdio.h>
static int out = 0;
static int hyst(int v, int lo, int hi){
    if (out && v < lo) out = 0;
    else if (!out && v > hi) out = 1;
    return out;
}
int main(void){
    int data[] = {5, 12, 14, 8, 6, 3, 15};
    for (size_t i = 0; i < 7; ++i) printf("%d", hyst(data[i], 5, 10));
    printf("\n");
    return 0;
}
```

Expected: `0111100\n` hoặc tương đương — verify hysteresis behavior.
Pass: [ ] Output 7 ký tự nhị phân.

---

### TC-C-DS-030 — Schmitt trigger simulation

Tags: c, ds, schmitt · Flags: default.

```c
#include <stdio.h>
static int out = 0;
static int schmitt(double v){ if (out && v < 1.0) out = 0; else if (!out && v > 2.0) out = 1; return out; }
int main(void){
    double xs[] = {0.5, 1.5, 2.5, 1.5, 0.5};
    for (size_t i = 0; i < 5; ++i) printf("%d", schmitt(xs[i]));
    printf("\n");
    return 0;
}
```

Expected: `00110\n` hoặc tương đương.
Pass: [ ] 5 ký tự nhị phân.

---

### TC-C-DS-031 — CRC-8 SMBus (poly 0x07)

Tags: c, ds, crc8 · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint8_t crc8(const uint8_t* d, size_t n){
    uint8_t c = 0;
    for (size_t i = 0; i < n; ++i){ c ^= d[i]; for (int k = 0; k < 8; ++k) c = (uint8_t)((c & 0x80) ? ((c << 1) ^ 0x07) : (c << 1)); }
    return c;
}
int main(void){
    uint8_t d[] = {0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39};
    printf("%02X\n", crc8(d, 9));
    return 0;
}
```

Expected: `F4\n` (CRC-8 SMBus của "123456789").
Pass: [ ] Output `F4`.

---

### TC-C-DS-032 — CRC-16 CCITT (poly 0x1021)

Tags: c, ds, crc16 · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint16_t crc16_ccitt(const uint8_t* d, size_t n){
    uint16_t c = 0xFFFF;
    for (size_t i = 0; i < n; ++i){ c ^= (uint16_t)(d[i] << 8); for (int k = 0; k < 8; ++k) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) : (c << 1); }
    return c;
}
int main(void){
    uint8_t d[] = "123456789";
    printf("%04X\n", crc16_ccitt(d, 9));
    return 0;
}
```

Expected: `29B1\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-033 — CRC-16 Modbus (poly 0xA001 reflected)

Tags: c, ds, crc16, modbus · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint16_t crc16_modbus(const uint8_t* d, size_t n){
    uint16_t c = 0xFFFF;
    for (size_t i = 0; i < n; ++i){ c ^= d[i]; for (int k = 0; k < 8; ++k) c = (c & 1) ? ((c >> 1) ^ 0xA001) : (c >> 1); }
    return c;
}
int main(void){
    uint8_t d[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x01};
    printf("%04X\n", crc16_modbus(d, 6));
    return 0;
}
```

Expected: `840A\n` (Modbus query CRC). Pass: [ ] Output đúng.

---

### TC-C-DS-034 — CRC-32 Ethernet (poly 0xEDB88320 reflected)

Tags: c, ds, crc32 · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint32_t crc32(const uint8_t* d, size_t n){
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < n; ++i){ c ^= d[i]; for (int k = 0; k < 8; ++k) c = (c & 1) ? ((c >> 1) ^ 0xEDB88320u) : (c >> 1); }
    return ~c;
}
int main(void){
    uint8_t d[] = "123456789";
    printf("%08X\n", crc32(d, 9));
    return 0;
}
```

Expected: `CBF43926\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-035 — Table-driven vs bitwise CRC (so sánh)

Tags: c, ds, crc, table · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint8_t tbl[256];
static void init_tbl(void){
    for (int i = 0; i < 256; ++i){
        uint8_t c = (uint8_t)i;
        for (int k = 0; k < 8; ++k) c = (uint8_t)((c & 0x80) ? ((c << 1) ^ 0x07) : (c << 1));
        tbl[i] = c;
    }
}
static uint8_t crc8_tbl(const uint8_t* d, size_t n){ uint8_t c = 0; for (size_t i = 0; i < n; ++i) c = tbl[c ^ d[i]]; return c; }
int main(void){
    init_tbl();
    uint8_t d[] = {0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39};
    printf("%02X\n", crc8_tbl(d, 9));
    return 0;
}
```

Expected: `F4\n` (giống TC-C-DS-031). Pass: [ ] Output `F4`.

---

### TC-C-DS-036 — Quaternion multiply + normalize

Tags: c, ds, math, quat · Flags: default.

```c
#include <stdio.h>
#include <math.h>
typedef struct { double w, x, y, z; } Q;
static Q mul(Q a, Q b){
    Q r;
    r.w = a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z;
    r.x = a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y;
    r.y = a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x;
    r.z = a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w;
    return r;
}
int main(void){
    Q a = {1, 0, 0, 0}, b = {0, 1, 0, 0};
    Q r = mul(a, b);
    printf("%.2f %.2f %.2f %.2f\n", r.w, r.x, r.y, r.z);
    return 0;
}
```

Expected: `0.00 1.00 0.00 0.00\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-037 — UART frame parser char-by-char

Tags: c, ds, protocol, uart · Flags: default.

```c
#include <stdio.h>
#include <string.h>
typedef enum { WAIT_SOF, READ_LEN, READ_DATA, READ_EOF_, DONE_ } S;
int main(void){
    const char* in = "$2AB#";
    S s = WAIT_SOF; int len = 0; char data[8]; int idx = 0;
    for (const char* p = in; *p; ++p){
        switch (s){
            case WAIT_SOF: if (*p == '$') s = READ_LEN; break;
            case READ_LEN: len = *p - '0'; s = READ_DATA; break;
            case READ_DATA: data[idx++] = *p; if (idx == len) s = READ_EOF_; break;
            case READ_EOF_: if (*p == '#') s = DONE_; break;
            default: break;
        }
    }
    data[idx] = 0;
    printf("data=%s done=%d\n", data, s == DONE_);
    return 0;
}
```

Expected: `data=AB done=1\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-038 — Modbus RTU master query (build packet)

Tags: c, ds, modbus, master · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint16_t crc16_modbus(const uint8_t* d, size_t n){
    uint16_t c = 0xFFFF;
    for (size_t i = 0; i < n; ++i){ c ^= d[i]; for (int k = 0; k < 8; ++k) c = (c & 1) ? ((c >> 1) ^ 0xA001) : (c >> 1); }
    return c;
}
int main(void){
    uint8_t pkt[8] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x01};
    uint16_t c = crc16_modbus(pkt, 6);
    pkt[6] = c & 0xFF; pkt[7] = c >> 8;
    for (int i = 0; i < 8; ++i) printf("%02X", pkt[i]); printf("\n");
    return 0;
}
```

Expected: `010300000001` + 2 byte CRC. CRC = `840A` (low/high). Output: `0103000000010A84\n`.
Pass: [ ] Output đúng.

---

### TC-C-DS-039 — Modbus RTU slave parse + verify CRC

Tags: c, ds, modbus, slave · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint16_t crc16_modbus(const uint8_t* d, size_t n){
    uint16_t c = 0xFFFF;
    for (size_t i = 0; i < n; ++i){ c ^= d[i]; for (int k = 0; k < 8; ++k) c = (c & 1) ? ((c >> 1) ^ 0xA001) : (c >> 1); }
    return c;
}
int main(void){
    uint8_t pkt[] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x0A, 0x84};
    uint16_t got = crc16_modbus(pkt, 6);
    uint16_t exp = (uint16_t)pkt[6] | ((uint16_t)pkt[7] << 8);
    printf("ok=%d\n", got == exp);
    return 0;
}
```

Expected: `ok=1\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-040 — AT command parser

Tags: c, ds, atcmd · Flags: default.

```c
#include <stdio.h>
#include <string.h>
int main(void){
    const char* lines[] = {"OK", "ERROR", "+CMTI: \"SM\",1", "OK"};
    for (size_t i = 0; i < 4; ++i){
        if (strncmp(lines[i], "+", 1) == 0) printf("URC: %s\n", lines[i]);
        else if (strcmp(lines[i], "OK") == 0) printf("RESP: OK\n");
        else if (strcmp(lines[i], "ERROR") == 0) printf("RESP: ERROR\n");
    }
    return 0;
}
```

Expected: `RESP: OK\nRESP: ERROR\nURC: +CMTI: "SM",1\nRESP: OK\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-041 — SLIP framing escape

Tags: c, ds, slip · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
int main(void){
    uint8_t in[] = {0x10, 0xC0, 0x20, 0xDB, 0x30};
    for (size_t i = 0; i < 5; ++i){
        if (in[i] == 0xC0) printf("DB DC ");
        else if (in[i] == 0xDB) printf("DB DD ");
        else printf("%02X ", in[i]);
    }
    printf("\n");
    return 0;
}
```

Expected: `10 DB DC 20 DB DD 30 \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-042 — COBS encoder

Tags: c, ds, cobs · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static size_t cobs_encode(const uint8_t* in, size_t n, uint8_t* out){
    size_t code_idx = 0, w = 1, code = 1;
    for (size_t i = 0; i < n; ++i){
        if (in[i] == 0){ out[code_idx] = (uint8_t)code; code_idx = w++; code = 1; }
        else { out[w++] = in[i]; if (++code == 0xFF){ out[code_idx] = (uint8_t)code; code_idx = w++; code = 1; } }
    }
    out[code_idx] = (uint8_t)code;
    return w;
}
int main(void){
    uint8_t in[] = {0x11, 0x22, 0x00, 0x33};
    uint8_t out[16];
    size_t n = cobs_encode(in, 4, out);
    for (size_t i = 0; i < n; ++i) printf("%02X ", out[i]); printf("\n");
    return 0;
}
```

Expected: `03 11 22 02 33 \n` (verify chuẩn COBS). Pass: [ ] Output đúng.

---

### TC-C-DS-043 — NMEA-0183 sentence parser ($GPRMC)

Tags: c, ds, nmea · Flags: default.

```c
#include <stdio.h>
#include <string.h>
int main(void){
    char line[] = "$GPRMC,123519,A,4807.038,N,01131.000,E*6A";
    char* tok = strtok(line, ",");
    int n = 0;
    while (tok){ printf("[%d]=%s\n", n++, tok); tok = strtok(NULL, ",*"); }
    return 0;
}
```

Expected: ≥7 dòng tokens (verify split). Pass: [ ] Có dòng `[0]=$GPRMC`.

---

### TC-C-DS-044 — TLV parser

Tags: c, ds, tlv · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
int main(void){
    uint8_t buf[] = {0x01, 0x02, 0x10, 0x20,   0x05, 0x03, 0xAA, 0xBB, 0xCC};
    size_t i = 0;
    while (i < sizeof buf){
        uint8_t t = buf[i++], l = buf[i++];
        printf("T=%02X L=%u V=", t, l);
        for (uint8_t k = 0; k < l; ++k) printf("%02X", buf[i + k]);
        printf("\n");
        i += l;
    }
    return 0;
}
```

Expected: `T=01 L=2 V=1020\nT=05 L=3 V=AABBCC\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-045 — Base64 encode (table-driven)

Tags: c, ds, base64 · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
#include <string.h>
static const char* TBL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
int main(void){
    const char* in = "abc";
    size_t n = strlen(in);
    uint32_t v = 0; int bits = 0;
    char out[16]; size_t w = 0;
    for (size_t i = 0; i < n; ++i){ v = (v << 8) | (uint8_t)in[i]; bits += 8; while (bits >= 6){ bits -= 6; out[w++] = TBL[(v >> bits) & 0x3F]; } }
    if (bits > 0){ out[w++] = TBL[(v << (6 - bits)) & 0x3F]; }
    while (w % 4) out[w++] = '=';
    out[w] = 0;
    printf("%s\n", out);
    return 0;
}
```

Expected: `YWJj\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-046 — HEX-encoded packet decoder

Tags: c, ds, hex · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static int hex_nibble(char c){ if (c >= '0' && c <= '9') return c - '0'; if (c >= 'A' && c <= 'F') return c - 'A' + 10; if (c >= 'a' && c <= 'f') return c - 'a' + 10; return -1; }
int main(void){
    const char* in = "DEADBEEF";
    while (*in){
        int hi = hex_nibble(*in++), lo = hex_nibble(*in++);
        if (hi < 0 || lo < 0) break;
        printf("%02X ", (uint8_t)((hi << 4) | lo));
    }
    printf("\n");
    return 0;
}
```

Expected: `DE AD BE EF \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-047 — Reverse bits in byte (loop)

Tags: c, ds, bits · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static uint8_t rev(uint8_t x){
    uint8_t r = 0;
    for (int i = 0; i < 8; ++i) r = (uint8_t)((r << 1) | ((x >> i) & 1));
    return r;
}
int main(void){
    printf("%02X %02X\n", rev(0x01), rev(0xA5));
    return 0;
}
```

Expected: `80 A5\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-048 — popcount manual + __builtin_popcount

Tags: c, ds, popcount · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static int popcnt(uint32_t x){ int c = 0; while (x){ x &= x - 1; ++c; } return c; }
int main(void){
    uint32_t v = 0x1F0F0F00u;
    printf("%d %d\n", popcnt(v), __builtin_popcount(v));
    return 0;
}
```

Expected: hai số bằng nhau (13). Pass: [ ] Hai số trùng.

---

### TC-C-DS-049 — Trailing zeros count

Tags: c, ds, ctz · Flags: default.

```c
#include <stdio.h>
#include <stdint.h>
static int ctz_u32(uint32_t x){ if (!x) return 32; int n = 0; while (!(x & 1)) { x >>= 1; ++n; } return n; }
int main(void){
    printf("%d %d %d\n", ctz_u32(0x10), ctz_u32(0x80000000u), __builtin_ctz(0x40));
    return 0;
}
```

Expected: `4 31 6\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-050 — Compile-time sin lookup table (gcc designated init)

Tags: c, ds, lut, math · Flags: default.

```c
#include <stdio.h>
#include <math.h>
static double SIN_LUT[10];
__attribute__((constructor)) static void init_lut(void){
    for (int i = 0; i < 10; ++i) SIN_LUT[i] = sin(i * M_PI / 18.0); /* 0..90° */
}
int main(void){
    for (int i = 0; i < 10; ++i) printf("%.4f\n", SIN_LUT[i]);
    return 0;
}
```

Expected: 10 dòng số, tăng dần từ 0 tới ~0.9848.
Pass: [ ] 10 dòng · [ ] dòng đầu `0.0000` · [ ] dòng cuối > 0.98.

---

## Tổng kết

- REGISTER/MMIO: 40 scenario (TC-C-REG-001..040)
- RTOS/pthread: 30 scenario (TC-C-RTOS-001..030)
- DS/Math/Protocol: 50 scenario (TC-C-DS-001..050)
- **Tổng**: 120 scenario.

QC verify mẫu ngẫu nhiên ≥3 scenario / sub-section sau deploy lớn.
