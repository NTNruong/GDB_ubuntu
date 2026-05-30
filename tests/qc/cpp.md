# tests/qc/cpp.md — C++ capability checklist

Phạm vi: STL + Modern gnu++20 + Threading + Firmware-adjacent C++.
Compile mặc định: `g++ -std=gnu++20 -O2 -Wall -Wextra` (debug `-g -O0` khi cần).

> 12 fields template. Code C++ inline.

---

## Section STL CORE (TC-CPP-001 → TC-CPP-016)

### TC-CPP-001 — std::vector basics

Tags: cpp, stl, vector · Pre: fresh · Stdin/Argv: empty · Flags: default.

```cpp
#include <iostream>
#include <vector>
#include <numeric>
int main() {
    std::vector<int> v{1,2,3,4,5};
    v.push_back(6); v.pop_back();
    std::cout << v.size() << " sum=" << std::accumulate(v.begin(), v.end(), 0) << "\n";
}
```

Expected: `5 sum=15\n`. Pass: [ ] Output đúng.

---

### TC-CPP-002 — std::map ordered iteration

Tags: cpp, stl, map · Flags: default.

```cpp
#include <iostream>
#include <map>
int main() {
    std::map<std::string,int> m{{"b",2},{"a",1},{"c",3}};
    for (auto& [k,v] : m) std::cout << k << "=" << v << "\n";
}
```

Expected: `a=1\nb=2\nc=3\n` (ordered). Pass: [ ] Sorted.

---

### TC-CPP-003 — std::unordered_map

Tags: cpp, stl, hash · Flags: default.

```cpp
#include <iostream>
#include <unordered_map>
int main() {
    std::unordered_map<int,std::string> m{{1,"a"},{2,"b"},{3,"c"}};
    std::cout << m.size() << " bucket=" << m.bucket_count() << "\n";
}
```

Expected: `3 bucket=` (impl-defined). Pass: [ ] size=3.

---

### TC-CPP-004 — std::set + multiset

Tags: cpp, stl, set · Flags: default.

```cpp
#include <iostream>
#include <set>
int main() {
    std::set<int> s{3,1,2,1};
    std::multiset<int> ms{3,1,2,1};
    std::cout << s.size() << " " << ms.size() << "\n";
}
```

Expected: `3 4\n`. Pass: [ ] Output đúng.

---

### TC-CPP-005 — queue/stack/priority_queue

Tags: cpp, stl, adapters · Flags: default.

```cpp
#include <iostream>
#include <queue>
#include <stack>
int main() {
    std::queue<int> q; q.push(1); q.push(2);
    std::stack<int> s; s.push(10); s.push(20);
    std::priority_queue<int> pq; pq.push(5); pq.push(3); pq.push(7);
    std::cout << q.front() << " " << s.top() << " " << pq.top() << "\n";
}
```

Expected: `1 20 7\n`. Pass: [ ] Output đúng.

---

### TC-CPP-006 — std::string ops (find, substr, replace)

Tags: cpp, stl, string · Flags: default.

```cpp
#include <iostream>
#include <string>
int main() {
    std::string s = "hello world";
    auto p = s.find("world");
    s.replace(p, 5, "C++20");
    std::cout << s << " " << s.substr(0, 5) << "\n";
}
```

Expected: `hello C++20 hello\n`. Pass: [ ] Output đúng.

---

### TC-CPP-007 — <algorithm>: sort/find/accumulate/transform

Tags: cpp, stl, algorithm · Flags: default.

```cpp
#include <iostream>
#include <vector>
#include <algorithm>
#include <numeric>
int main() {
    std::vector<int> v{5,3,1,4,2};
    std::sort(v.begin(), v.end());
    std::transform(v.begin(), v.end(), v.begin(), [](int x){ return x*x; });
    std::cout << std::accumulate(v.begin(), v.end(), 0) << "\n";
}
```

Expected: `55\n` (1+4+9+16+25). Pass: [ ] Output đúng.

---

### TC-CPP-008 — Iterator categories (forward/bidirectional/random)

Tags: cpp, stl, iterator · Flags: default.

```cpp
#include <iostream>
#include <list>
#include <vector>
#include <iterator>
template<typename It>
void check() {
    using cat = typename std::iterator_traits<It>::iterator_category;
    std::cout << (std::is_same_v<cat, std::random_access_iterator_tag> ? "RA" :
                  std::is_same_v<cat, std::bidirectional_iterator_tag>  ? "Bidi" : "Other") << "\n";
}
int main() {
    check<std::vector<int>::iterator>();
    check<std::list<int>::iterator>();
}
```

Expected: `RA\nBidi\n`. Pass: [ ] Output đúng.

---

### TC-CPP-009 — std::regex match + replace

Tags: cpp, stl, regex · Flags: default.

```cpp
#include <iostream>
#include <regex>
#include <string>
int main() {
    std::regex re("\\d+");
    std::string s = "abc 42 def 100";
    auto out = std::regex_replace(s, re, "#");
    std::cout << out << "\n";
}
```

Expected: `abc # def #\n`. Pass: [ ] Output đúng.

---

### TC-CPP-010 — std::chrono timing

Tags: cpp, stl, chrono · Flags: default.

```cpp
#include <iostream>
#include <chrono>
int main() {
    auto t0 = std::chrono::steady_clock::now();
    volatile long s = 0; for (long i = 0; i < 1000000; ++i) s += i;
    auto t1 = std::chrono::steady_clock::now();
    std::cout << "elapsed_ms<=" << std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count() << "\n";
}
```

Expected: `elapsed_ms<=` số nguyên ≥ 0. Pass: [ ] Có output `elapsed_ms<=`.

---

### TC-CPP-011 — std::random uniform_int_distribution

Tags: cpp, stl, random · Flags: default.

```cpp
#include <iostream>
#include <random>
int main() {
    std::mt19937 rng(42);
    std::uniform_int_distribution<int> d(1, 6);
    for (int i = 0; i < 5; ++i) std::cout << d(rng) << " ";
    std::cout << "\n";
}
```

Expected: 5 số trong [1,6] (deterministic với seed 42).
Pass: [ ] 5 số, mỗi số ∈ [1,6].

---

### TC-CPP-012 — std::optional / std::variant

Tags: cpp, stl, optional · Flags: default.

```cpp
#include <iostream>
#include <optional>
#include <variant>
int main() {
    std::optional<int> o = 42;
    std::variant<int,std::string> v = std::string("hi");
    std::cout << o.value() << " " << std::get<std::string>(v) << "\n";
}
```

Expected: `42 hi\n`. Pass: [ ] Output đúng.

---

### TC-CPP-013 — std::pair / std::tuple

Tags: cpp, stl, tuple · Flags: default.

```cpp
#include <iostream>
#include <tuple>
int main() {
    auto t = std::make_tuple(1, 2.5, std::string("ok"));
    auto [a,b,c] = t;
    std::cout << a << " " << b << " " << c << "\n";
}
```

Expected: `1 2.5 ok\n`. Pass: [ ] Output đúng.

---

### TC-CPP-014 — std::unique_ptr

Tags: cpp, stl, smart-ptr · Flags: default.

```cpp
#include <iostream>
#include <memory>
struct W { ~W() { std::cout << "destroy\n"; } int v = 7; };
int main() {
    auto p = std::make_unique<W>();
    std::cout << p->v << "\n";
}
```

Expected: `7\ndestroy\n`. Pass: [ ] Output đúng.

---

### TC-CPP-015 — std::shared_ptr / weak_ptr

Tags: cpp, stl, shared · Flags: default.

```cpp
#include <iostream>
#include <memory>
int main() {
    auto s = std::make_shared<int>(99);
    std::weak_ptr<int> w = s;
    std::cout << s.use_count() << " expired=" << w.expired() << "\n";
    s.reset();
    std::cout << "expired=" << w.expired() << "\n";
}
```

Expected: `1 expired=0\nexpired=1\n`. Pass: [ ] Output đúng.

---

### TC-CPP-016 — std::deque / std::array / std::list

Tags: cpp, stl, sequence · Flags: default.

```cpp
#include <iostream>
#include <deque>
#include <array>
#include <list>
int main() {
    std::deque<int> d{1,2,3}; d.push_front(0);
    std::array<int,4> a{10,20,30,40};
    std::list<int> l{100,200,300};
    std::cout << d.front() << " " << a[2] << " " << l.back() << "\n";
}
```

Expected: `0 30 300\n`. Pass: [ ] Output đúng.

---

## Section MODERN gnu++20 (TC-CPP-017 → TC-CPP-034)

### TC-CPP-017 — Structured bindings

Tags: cpp, c++17 · Flags: default.

```cpp
#include <iostream>
#include <map>
int main() {
    std::map<int,std::string> m{{1,"a"},{2,"b"}};
    for (auto& [k,v] : m) std::cout << k << v << " ";
    std::cout << "\n";
}
```

Expected: `1a 2b \n`. Pass: [ ] Output đúng.

---

### TC-CPP-018 — if constexpr

Tags: cpp, c++17 · Flags: default.

```cpp
#include <iostream>
#include <type_traits>
template<typename T>
auto describe() {
    if constexpr (std::is_integral_v<T>) return "int";
    else return "non-int";
}
int main() {
    std::cout << describe<int>() << " " << describe<double>() << "\n";
}
```

Expected: `int non-int\n`. Pass: [ ] Output đúng.

---

### TC-CPP-019 — Fold expression

Tags: cpp, c++17, fold · Flags: default.

```cpp
#include <iostream>
template<typename... Ts>
auto sum(Ts... xs) { return (xs + ...); }
int main() {
    std::cout << sum(1,2,3,4,5) << "\n";
}
```

Expected: `15\n`. Pass: [ ] Output đúng.

---

### TC-CPP-020 — Constexpr lambda

Tags: cpp, c++17 · Flags: default.

```cpp
#include <iostream>
int main() {
    constexpr auto sq = [](int x) constexpr { return x*x; };
    static_assert(sq(5) == 25);
    std::cout << sq(7) << "\n";
}
```

Expected: `49\n`. Pass: [ ] Output đúng.

---

### TC-CPP-021 — std::ranges::views::transform + filter

Tags: cpp, c++20, ranges · Flags: default.

```cpp
#include <iostream>
#include <ranges>
#include <vector>
int main() {
    std::vector<int> v{1,2,3,4,5,6};
    auto r = v | std::views::filter([](int x){ return x % 2 == 0; })
               | std::views::transform([](int x){ return x*10; });
    for (int x : r) std::cout << x << " ";
    std::cout << "\n";
}
```

Expected: `20 40 60 \n`. Pass: [ ] Output đúng.

---

### TC-CPP-022 — std::ranges::sort + algorithms

Tags: cpp, c++20, ranges · Flags: default.

```cpp
#include <iostream>
#include <ranges>
#include <vector>
#include <algorithm>
int main() {
    std::vector<int> v{5,2,8,1,9,3};
    std::ranges::sort(v);
    for (int x : v) std::cout << x << " ";
    std::cout << "\n";
}
```

Expected: `1 2 3 5 8 9 \n`. Pass: [ ] Output đúng.

---

### TC-CPP-023 — Concepts: Numeric

Tags: cpp, c++20, concepts · Flags: default.

```cpp
#include <iostream>
#include <concepts>
template<typename T>
concept Numeric = std::integral<T> || std::floating_point<T>;
template<Numeric T>
T twice(T x) { return x + x; }
int main() {
    std::cout << twice(3) << " " << twice(2.5) << "\n";
}
```

Expected: `6 5\n`. Pass: [ ] Output đúng.

---

### TC-CPP-024 — Concepts: requires clause

Tags: cpp, c++20, requires · Flags: default.

```cpp
#include <iostream>
template<typename T>
requires requires(T a, T b) { a + b; }
T add(T a, T b) { return a + b; }
int main() {
    std::cout << add(1, 2) << " " << add(std::string("x"), std::string("y")) << "\n";
}
```

Expected: `3 xy\n`. Pass: [ ] Output đúng.

---

### TC-CPP-025 — Coroutine generator (simple)

Tags: cpp, c++20, coroutine · Flags: default + `-fcoroutines`.

```cpp
#include <iostream>
#include <coroutine>
struct Gen {
    struct promise_type {
        int value;
        Gen get_return_object() { return Gen{std::coroutine_handle<promise_type>::from_promise(*this)}; }
        std::suspend_always initial_suspend() { return {}; }
        std::suspend_always final_suspend() noexcept { return {}; }
        std::suspend_always yield_value(int v) { value = v; return {}; }
        void return_void() {}
        void unhandled_exception() { std::terminate(); }
    };
    std::coroutine_handle<promise_type> h;
    ~Gen() { if (h) h.destroy(); }
    bool next() { h.resume(); return !h.done(); }
    int value() const { return h.promise().value; }
};
Gen counter(int n) { for (int i = 0; i < n; ++i) co_yield i; }
int main() {
    auto g = counter(3);
    while (g.next()) std::cout << g.value() << " ";
    std::cout << "\n";
}
```

Expected: `0 1 2 \n`. Pass: [ ] Output đúng.
Notes: gnu++20 mặc định bật coroutines.

---

### TC-CPP-026 — std::span

Tags: cpp, c++20, span · Flags: default.

```cpp
#include <iostream>
#include <span>
#include <array>
void print(std::span<const int> s) { for (int x : s) std::cout << x << " "; std::cout << "\n"; }
int main() {
    std::array<int,5> a{1,2,3,4,5};
    print(a);
    print(std::span(a).subspan(1, 3));
}
```

Expected: `1 2 3 4 5 \n2 3 4 \n`. Pass: [ ] Output đúng.

---

### TC-CPP-027 — std::format

Tags: cpp, c++20, format · Flags: default.

```cpp
#include <iostream>
#include <format>
int main() {
    std::cout << std::format("x={} hex={:#x} pad={:>6}\n", 42, 255, "ok");
}
```

Expected: `x=42 hex=0xff pad=    ok\n`. Pass: [ ] Output đúng.
Notes: GCC 13+ hỗ trợ `<format>`. Nếu không có → bỏ qua.

---

### TC-CPP-028 — <bit>: bit_cast / popcount / bit_width

Tags: cpp, c++20, bit · Flags: default.

```cpp
#include <iostream>
#include <bit>
#include <cstdint>
int main() {
    float f = 1.0f;
    auto u = std::bit_cast<std::uint32_t>(f);
    std::cout << std::hex << u << std::dec << "\n";
    std::cout << std::popcount(0xF0F0F0F0u) << " " << std::bit_width(0xFFu) << "\n";
}
```

Expected: `3f800000\n16 8\n`. Pass: [ ] Output đúng.

---

### TC-CPP-029 — <numbers>: std::numbers::pi

Tags: cpp, c++20, numbers · Flags: default.

```cpp
#include <iostream>
#include <numbers>
#include <iomanip>
int main() {
    std::cout << std::fixed << std::setprecision(6) << std::numbers::pi << "\n";
}
```

Expected: `3.141593\n`. Pass: [ ] Output đúng.

---

### TC-CPP-030 — Three-way operator <=>

Tags: cpp, c++20, spaceship · Flags: default.

```cpp
#include <iostream>
#include <compare>
struct Point { int x, y; auto operator<=>(const Point&) const = default; };
int main() {
    Point a{1,2}, b{1,3};
    std::cout << (a < b) << " " << (a == b) << "\n";
}
```

Expected: `1 0\n`. Pass: [ ] Output đúng.

---

### TC-CPP-031 — Designated initializers

Tags: cpp, c++20, designated · Flags: default.

```cpp
#include <iostream>
struct Cfg { int port = 8080; const char* host = "default"; };
int main() {
    Cfg c{.port = 4000, .host = "api"};
    std::cout << c.host << ":" << c.port << "\n";
}
```

Expected: `api:4000\n`. Pass: [ ] Output đúng.

---

### TC-CPP-032 — consteval

Tags: cpp, c++20, consteval · Flags: default.

```cpp
#include <iostream>
consteval int square(int x) { return x*x; }
int main() {
    constexpr int v = square(5);
    std::cout << v << "\n";
}
```

Expected: `25\n`. Pass: [ ] Output đúng.

---

### TC-CPP-033 — Lambda template parameter

Tags: cpp, c++20, lambda · Flags: default.

```cpp
#include <iostream>
int main() {
    auto add = []<typename T>(T a, T b) { return a + b; };
    std::cout << add(1, 2) << " " << add(1.5, 2.5) << "\n";
}
```

Expected: `3 4\n`. Pass: [ ] Output đúng.

---

### TC-CPP-034 — constinit

Tags: cpp, c++20, constinit · Flags: default.

```cpp
#include <iostream>
constinit int g_count = 42;
int main() { std::cout << g_count << "\n"; }
```

Expected: `42\n`. Pass: [ ] Output đúng.

---

## Section THREADING (TC-CPP-035 → TC-CPP-041)

### TC-CPP-035 — std::thread + join

Tags: cpp, thread · Flags: default.

```cpp
#include <iostream>
#include <thread>
int main() {
    int x = 0;
    std::thread t([&]{ x = 7; });
    t.join();
    std::cout << x << "\n";
}
```

Expected: `7\n`. Pass: [ ] Output đúng.

---

### TC-CPP-036 — std::mutex + lock_guard

Tags: cpp, thread, mutex · Flags: default.

```cpp
#include <iostream>
#include <mutex>
#include <thread>
int main() {
    int s = 0; std::mutex m;
    auto fn = [&]{ for (int i = 0; i < 1000; ++i){ std::lock_guard g(m); ++s; } };
    std::thread t1(fn), t2(fn);
    t1.join(); t2.join();
    std::cout << s << "\n";
}
```

Expected: `2000\n`. Pass: [ ] Output đúng.

---

### TC-CPP-037 — std::condition_variable

Tags: cpp, thread, cv · Flags: default.

```cpp
#include <iostream>
#include <thread>
#include <mutex>
#include <condition_variable>
int main() {
    std::mutex m; std::condition_variable cv; bool ready = false; int data = 0;
    std::thread t([&]{
        std::unique_lock l(m);
        cv.wait(l, [&]{ return ready; });
        std::cout << "got=" << data << "\n";
    });
    { std::lock_guard l(m); data = 99; ready = true; }
    cv.notify_one();
    t.join();
}
```

Expected: `got=99\n`. Pass: [ ] Output đúng.

---

### TC-CPP-038 — std::atomic + memory_order

Tags: cpp, thread, atomic · Flags: default.

```cpp
#include <iostream>
#include <atomic>
#include <thread>
int main() {
    std::atomic<int> a = 0;
    std::thread t1([&]{ for (int i = 0; i < 500; ++i) a.fetch_add(1, std::memory_order_relaxed); });
    std::thread t2([&]{ for (int i = 0; i < 500; ++i) a.fetch_add(1, std::memory_order_relaxed); });
    t1.join(); t2.join();
    std::cout << a.load() << "\n";
}
```

Expected: `1000\n`. Pass: [ ] Output đúng.

---

### TC-CPP-039 — std::jthread + stop_token

Tags: cpp, c++20, jthread · Flags: default.

```cpp
#include <iostream>
#include <thread>
#include <atomic>
int main() {
    std::atomic<int> c = 0;
    std::jthread t([&](std::stop_token st){ while (!st.stop_requested()) ++c; });
    while (c.load() < 100) {}
    t.request_stop();
    std::cout << "stopped at >=100: c=" << c.load() << "\n";
}
```

Expected: `stopped at >=100: c=` số ≥ 100. Pass: [ ] Có dòng `stopped at >=100`.

---

### TC-CPP-040 — std::shared_mutex (read-write)

Tags: cpp, thread, rwlock · Flags: default.

```cpp
#include <iostream>
#include <shared_mutex>
int main() {
    std::shared_mutex m;
    int data = 0;
    { std::unique_lock l(m); data = 7; }
    { std::shared_lock l(m); std::cout << data << "\n"; }
}
```

Expected: `7\n`. Pass: [ ] Output đúng.

---

### TC-CPP-041 — std::async / future / promise

Tags: cpp, thread, future · Flags: default.

```cpp
#include <iostream>
#include <future>
int main() {
    auto f = std::async(std::launch::async, []{ return 42; });
    std::cout << f.get() << "\n";
    std::promise<int> p;
    auto fp = p.get_future();
    p.set_value(99);
    std::cout << fp.get() << "\n";
}
```

Expected: `42\n99\n`. Pass: [ ] Output đúng.

---

## Section FIRMWARE-ADJACENT (TC-CPP-042 → TC-CPP-060)

### TC-CPP-042 — std::array fixed-size buffer (no heap)

Tags: cpp, embed, no-heap · Flags: default.

```cpp
#include <iostream>
#include <array>
int main() {
    std::array<int, 8> buf{};
    for (int i = 0; i < 8; ++i) buf[i] = i * i;
    int s = 0; for (auto x : buf) s += x;
    std::cout << "size=" << buf.size() << " sum=" << s << "\n";
}
```

Expected: `size=8 sum=140\n`. Pass: [ ] Output đúng.

---

### TC-CPP-043 — Template Reg<addr> type-safe MMIO wrapper

Tags: cpp, embed, mmio · Flags: default.

```cpp
#include <iostream>
#include <cstdint>
static std::uint32_t fake_mem[4];
template<std::uintptr_t Addr>
struct Reg {
    static volatile std::uint32_t& ref() { return *reinterpret_cast<volatile std::uint32_t*>(Addr); }
    static void write(std::uint32_t v) { ref() = v; }
    static std::uint32_t read() { return ref(); }
};
int main() {
    using GPIOA_MODER = Reg<reinterpret_cast<std::uintptr_t>(&fake_mem[0])>;
    GPIOA_MODER::write(0xCAFEBABE);
    std::cout << std::hex << GPIOA_MODER::read() << "\n";
}
```

Expected: `cafebabe\n`. Pass: [ ] Output đúng.

---

### TC-CPP-044 — Template Pin<port,bit> GPIO abstraction

Tags: cpp, embed, gpio · Flags: default.

```cpp
#include <iostream>
#include <cstdint>
static std::uint32_t port[4];
template<int Port, int Bit>
struct Pin {
    static void set()    { port[Port] |=  (1u << Bit); }
    static void clear()  { port[Port] &= ~(1u << Bit); }
    static bool read()   { return port[Port] & (1u << Bit); }
};
int main() {
    Pin<0, 3>::set();
    Pin<0, 5>::set();
    Pin<0, 3>::clear();
    std::cout << std::hex << port[0] << " " << Pin<0,5>::read() << "\n";
}
```

Expected: `20 1\n`. Pass: [ ] Output đúng.

---

### TC-CPP-045 — Custom static allocator (arena)

Tags: cpp, embed, allocator · Flags: default.

```cpp
#include <iostream>
#include <cstddef>
static char arena[256];
static std::size_t off = 0;
template<typename T>
T* arena_new() {
    if (off + sizeof(T) > sizeof arena) return nullptr;
    T* p = new(arena + off) T{};
    off += sizeof(T);
    return p;
}
int main() {
    int* a = arena_new<int>(); *a = 42;
    int* b = arena_new<int>(); *b = 99;
    std::cout << *a << " " << *b << " off=" << off << "\n";
}
```

Expected: `42 99 off=8\n`. Pass: [ ] Output đúng (off có thể khác do align).

---

### TC-CPP-046 — constexpr CRC table generation

Tags: cpp, embed, constexpr, crc · Flags: default.

```cpp
#include <iostream>
#include <array>
#include <cstdint>
constexpr std::array<std::uint8_t, 256> gen_tbl() {
    std::array<std::uint8_t, 256> t{};
    for (int i = 0; i < 256; ++i) {
        std::uint8_t c = (std::uint8_t)i;
        for (int k = 0; k < 8; ++k) c = (std::uint8_t)((c & 0x80) ? ((c << 1) ^ 0x07) : (c << 1));
        t[i] = c;
    }
    return t;
}
int main() {
    constexpr auto tbl = gen_tbl();
    std::cout << std::hex << (int)tbl[0x12] << " " << (int)tbl[0xFF] << "\n";
}
```

Expected: 2 giá trị hex thuộc về bảng CRC-8. Pass: [ ] Có 2 số hex.

---

### TC-CPP-047 — constexpr lookup table (sin)

Tags: cpp, embed, lut · Flags: default.

```cpp
#include <iostream>
#include <array>
#include <cmath>
#include <numbers>
constexpr std::array<double, 10> gen_sin() {
    std::array<double, 10> a{};
    /* không thể gọi std::sin trong constexpr cho tới C++23; demo: tính qua Taylor */
    for (int i = 0; i < 10; ++i) {
        double x = i * std::numbers::pi / 18.0;
        double s = 0, term = x; int sign = 1;
        for (int k = 0; k < 10; ++k) {
            s += sign * term;
            term *= x * x / ((2*k+2) * (2*k+3));
            sign = -sign;
        }
        a[i] = s;
    }
    return a;
}
int main() {
    constexpr auto lut = gen_sin();
    for (double v : lut) std::cout << v << " "; std::cout << "\n";
}
```

Expected: 10 số, đầu ~0, cuối ~0.985. Pass: [ ] Output 10 số.

---

### TC-CPP-048 — Type-safe units (tag types)

Tags: cpp, embed, units · Flags: default.

```cpp
#include <iostream>
template<typename Tag>
struct Quantity { double v; };
struct Meters{}; struct Seconds{};
using m = Quantity<Meters>;
using s = Quantity<Seconds>;
int main() {
    m d{100}; s t{20};
    /* d / t = m/s — tách type không cộng/trừ giữa Meters và Seconds */
    std::cout << "speed=" << d.v / t.v << "\n";
}
```

Expected: `speed=5\n`. Pass: [ ] Output đúng.

---

### TC-CPP-049 — std::bitset for register flags

Tags: cpp, embed, bitset · Flags: default.

```cpp
#include <iostream>
#include <bitset>
int main() {
    std::bitset<8> flags;
    flags.set(0); flags.set(3); flags.set(7);
    std::cout << flags.to_string() << " count=" << flags.count() << "\n";
}
```

Expected: `10001001 count=3\n`. Pass: [ ] Output đúng.

---

### TC-CPP-050 — std::variant FSM (state per type)

Tags: cpp, embed, variant, fsm · Flags: default.

```cpp
#include <iostream>
#include <variant>
struct Idle {}; struct Running { int speed; }; struct Stopped { int reason; };
using State = std::variant<Idle, Running, Stopped>;
int main() {
    State s = Running{42};
    std::visit([](auto&& v){
        using T = std::decay_t<decltype(v)>;
        if constexpr (std::is_same_v<T, Idle>) std::cout << "Idle\n";
        else if constexpr (std::is_same_v<T, Running>) std::cout << "Run " << v.speed << "\n";
        else std::cout << "Stop " << v.reason << "\n";
    }, s);
}
```

Expected: `Run 42\n`. Pass: [ ] Output đúng.

---

### TC-CPP-051 — Compile-time PID gain tuning (template)

Tags: cpp, embed, template, pid · Flags: default.

```cpp
#include <iostream>
template<int Kp_x100, int Ki_x100>
struct Pid {
    double i = 0;
    double step(double e, double dt) { i += e * dt; return Kp_x100/100.0 * e + Ki_x100/100.0 * i; }
};
int main() {
    Pid<150, 50> p;
    std::cout << p.step(2.0, 0.1) << "\n";
}
```

Expected: `3.1\n`. Pass: [ ] Output đúng.

---

### TC-CPP-052 — Tag dispatch for driver variants

Tags: cpp, embed, tag · Flags: default.

```cpp
#include <iostream>
struct CPU_M0{}; struct CPU_M4{};
void init(CPU_M0) { std::cout << "M0 init\n"; }
void init(CPU_M4) { std::cout << "M4 init\n"; }
template<typename T>
void boot() { init(T{}); }
int main() { boot<CPU_M0>(); boot<CPU_M4>(); }
```

Expected: `M0 init\nM4 init\n`. Pass: [ ] Output đúng.

---

### TC-CPP-053 — CRTP static polymorphism

Tags: cpp, embed, crtp · Flags: default.

```cpp
#include <iostream>
template<typename D>
struct Driver { void send() { static_cast<D*>(this)->do_send(); } };
struct UartDrv : Driver<UartDrv> { void do_send() { std::cout << "uart\n"; } };
struct SpiDrv  : Driver<SpiDrv>  { void do_send() { std::cout << "spi\n"; } };
int main() { UartDrv u; u.send(); SpiDrv s; s.send(); }
```

Expected: `uart\nspi\n`. Pass: [ ] Output đúng.

---

### TC-CPP-054 — Policy-based design

Tags: cpp, embed, policy · Flags: default.

```cpp
#include <iostream>
struct PolicyA { static void log(const char* s) { std::cout << "A:" << s << "\n"; } };
struct PolicyB { static void log(const char* s) { std::cout << "B:" << s << "\n"; } };
template<typename P>
struct Engine { void run() { P::log("run"); } };
int main() { Engine<PolicyA>{}.run(); Engine<PolicyB>{}.run(); }
```

Expected: `A:run\nB:run\n`. Pass: [ ] Output đúng.

---

### TC-CPP-055 — SFINAE requires

Tags: cpp, embed, sfinae · Flags: default.

```cpp
#include <iostream>
template<typename T> requires requires(T t) { t.size(); }
auto sz(T& t) { return t.size(); }
template<typename T> requires (!requires(T t) { t.size(); })
auto sz(T&) { return 0; }
int main() {
    std::string s = "hi";
    std::cout << sz(s) << "\n";
}
```

Expected: `2\n`. Pass: [ ] Output đúng.

---

### TC-CPP-056 — Non-type template params (buffer size)

Tags: cpp, embed, nttp · Flags: default.

```cpp
#include <iostream>
#include <array>
template<std::size_t N>
struct Buf { std::array<int, N> data{}; constexpr std::size_t size() const { return N; } };
int main() {
    Buf<16> b16;
    Buf<32> b32;
    std::cout << b16.size() << " " << b32.size() << "\n";
}
```

Expected: `16 32\n`. Pass: [ ] Output đúng.

---

### TC-CPP-057 — constexpr bubble sort

Tags: cpp, embed, constexpr · Flags: default.

```cpp
#include <iostream>
#include <array>
constexpr auto sort_arr(std::array<int, 5> a) {
    for (int i = 0; i < 5; ++i)
        for (int j = 0; j < 4 - i; ++j)
            if (a[j] > a[j+1]) { int t = a[j]; a[j] = a[j+1]; a[j+1] = t; }
    return a;
}
int main() {
    constexpr auto s = sort_arr({3,1,4,1,5});
    for (int x : s) std::cout << x << " "; std::cout << "\n";
}
```

Expected: `1 1 3 4 5 \n`. Pass: [ ] Output đúng.

---

### TC-CPP-058 — Memory-mapped struct via reinterpret_cast + static_assert align

Tags: cpp, embed, mmio · Flags: default.

```cpp
#include <iostream>
#include <cstdint>
struct GpioRegs { std::uint32_t MODER, OTYPER, OSPEEDR, PUPDR; };
static_assert(sizeof(GpioRegs) == 16);
static std::uint32_t fake[4] = {0xAAAA0000u, 0, 0xFFFF0000u, 0};
int main() {
    auto* p = reinterpret_cast<volatile GpioRegs*>(fake);
    std::cout << std::hex << p->MODER << " " << p->OSPEEDR << "\n";
}
```

Expected: `aaaa0000 ffff0000\n`. Pass: [ ] Output đúng.

---

### TC-CPP-059 — noexcept all-the-way

Tags: cpp, embed, noexcept · Flags: default.

```cpp
#include <iostream>
struct Drv { void send() noexcept { std::cout << "send\n"; } };
template<typename T>
void run(T& t) noexcept(noexcept(t.send())) { t.send(); }
int main() {
    Drv d;
    static_assert(noexcept(run(d)));
    run(d);
}
```

Expected: `send\n`. Pass: [ ] Output đúng.

---

### TC-CPP-060 — Concepts-constrained driver template

Tags: cpp, embed, concepts · Flags: default.

```cpp
#include <iostream>
#include <concepts>
template<typename T>
concept Writable = requires(T t, int v) { { t.write(v) } -> std::same_as<void>; };
struct Uart { void write(int v) { std::cout << "uart=" << v << "\n"; } };
template<Writable T>
void send_all(T& t) { for (int i = 0; i < 3; ++i) t.write(i); }
int main() { Uart u; send_all(u); }
```

Expected: `uart=0\nuart=1\nuart=2\n`. Pass: [ ] Output đúng.

---

## Tổng kết cpp.md

- STL CORE: 16 (TC-CPP-001..016)
- MODERN gnu++20: 18 (TC-CPP-017..034)
- THREADING: 7 (TC-CPP-035..041)
- FIRMWARE-ADJACENT: 19 (TC-CPP-042..060)
- **Tổng**: 60 scenario.
