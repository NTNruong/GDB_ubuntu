# tests/qc/c-dsa.md — C classic data structures & algorithms

Phạm vi: DSA giáo trình kinh điển (CS thuần), không liên quan firmware/MMIO.
Compile mặc định: `gcc -std=gnu17 -O2 -Wall -Wextra -lm` (debug `-g -O0` khi cần).
Liên kết: [`INDEX.md`](INDEX.md) · [`c-embedded.md`](c-embedded.md) · [`runner.md`](runner.md).

> **Đánh số nối tiếp** prefix `TC-C-DS-###`: c-embedded.md giữ TC-C-DS-001→050 (firmware DS/Math/Protocol), file này tiếp tục từ **TC-C-DS-051→090** (classic CS). Số **không reset**.
>
> Mỗi scenario theo template 12 trường. Đa số là **Run** (đối chiếu stdout); 5 scenario có biến thể **Debug DAP** (đánh dấu 🐞) để phủ khả năng inspect cấu trúc dữ liệu (breakpoint / step / watch / expand / call stack).

---

## Section ARRAY / STRING (TC-C-DS-051 → TC-C-DS-058)

### TC-C-DS-051 — Reverse array in-place (two-pointer)

Tags: c, dsa, array, two-pointer · Pre: fresh · Stdin/Argv: empty · Flags: default.

```c
#include <stdio.h>
int main(void){
    int a[] = {1,2,3,4,5};
    int n = 5;
    for (int i = 0, j = n - 1; i < j; ++i, --j){ int t = a[i]; a[i] = a[j]; a[j] = t; }
    for (int i = 0; i < n; ++i) printf("%d ", a[i]);
    printf("\n");
    return 0;
}
```

UI: C → Paste → Run.
Expected: stdout `5 4 3 2 1 \n`, exit 0.
Pass: [ ] Output đúng · [ ] Exit 0.
Notes: ISSUE: (none).

---

### TC-C-DS-052 — Left-rotate by k (reversal algorithm)

Tags: c, dsa, array, rotate · Flags: default.

```c
#include <stdio.h>
static void rev(int* a, int i, int j){ while (i < j){ int t = a[i]; a[i] = a[j]; a[j] = t; ++i; --j; } }
int main(void){
    int a[] = {1,2,3,4,5,6,7}; int n = 7, k = 3;
    rev(a, 0, k - 1); rev(a, k, n - 1); rev(a, 0, n - 1);
    for (int i = 0; i < n; ++i) printf("%d ", a[i]); printf("\n");
    return 0;
}
```

UI: Run.
Expected: `4 5 6 7 1 2 3 \n` (xoay trái 3 vị trí).
Pass: [ ] Output đúng.

---

### TC-C-DS-053 — Kadane max subarray sum

Tags: c, dsa, array, kadane · Flags: default.

```c
#include <stdio.h>
int main(void){
    int a[] = {-2,1,-3,4,-1,2,1,-5,4}; int n = 9;
    int best = a[0], cur = a[0];
    for (int i = 1; i < n; ++i){ cur = (a[i] > cur + a[i]) ? a[i] : cur + a[i]; if (cur > best) best = cur; }
    printf("max=%d\n", best);
    return 0;
}
```

Expected: `max=6\n` (đoạn `4,-1,2,1`). Pass: [ ] Output đúng.

---

### TC-C-DS-054 — Binary search (iterative)

Tags: c, dsa, search, binary · Flags: default.

```c
#include <stdio.h>
static int bsearch_i(const int* a, int n, int key){
    int lo = 0, hi = n - 1;
    while (lo <= hi){ int mid = lo + (hi - lo) / 2; if (a[mid] == key) return mid; if (a[mid] < key) lo = mid + 1; else hi = mid - 1; }
    return -1;
}
int main(void){
    int a[] = {1,3,5,7,9,11}; int n = 6;
    printf("idx7=%d idx4=%d\n", bsearch_i(a, n, 7), bsearch_i(a, n, 4));
    return 0;
}
```

Expected: `idx7=3 idx4=-1\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-055 — lower_bound / upper_bound

Tags: c, dsa, search, bound · Flags: default.

```c
#include <stdio.h>
static int lower_bound(const int* a, int n, int x){ int lo = 0, hi = n; while (lo < hi){ int m = (lo + hi) / 2; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
static int upper_bound(const int* a, int n, int x){ int lo = 0, hi = n; while (lo < hi){ int m = (lo + hi) / 2; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; }
int main(void){
    int a[] = {1,2,2,2,3,4}; int n = 6;
    printf("lb=%d ub=%d count=%d\n", lower_bound(a, n, 2), upper_bound(a, n, 2), upper_bound(a, n, 2) - lower_bound(a, n, 2));
    return 0;
}
```

Expected: `lb=1 ub=4 count=3\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-056 — Two-sum (linear-probe hash)

Tags: c, dsa, hash, two-sum · Flags: default.

```c
#include <stdio.h>
#include <string.h>
#define H 17
int main(void){
    int a[] = {2,7,11,15}; int n = 4, target = 9;
    int keys[H], vals[H], used[H];
    memset(used, 0, sizeof used);
    int r0 = -1, r1 = -1;
    for (int i = 0; i < n; ++i){
        int need = target - a[i];
        int found = -1;
        for (int h = ((need % H) + H) % H, s = 0; s < H; ++s, h = (h + 1) % H){
            if (!used[h]) break;
            if (keys[h] == need){ found = vals[h]; break; }
        }
        if (found != -1){ r0 = found; r1 = i; break; }
        for (int h = ((a[i] % H) + H) % H, s = 0; s < H; ++s, h = (h + 1) % H){
            if (!used[h]){ used[h] = 1; keys[h] = a[i]; vals[h] = i; break; }
        }
    }
    printf("i=%d j=%d\n", r0, r1);
    return 0;
}
```

Expected: `i=0 j=1\n` (a[0]+a[1]=2+7=9). Pass: [ ] Output đúng.

---

### TC-C-DS-057 — Dutch national flag (3-way partition)

Tags: c, dsa, array, partition · Flags: default.

```c
#include <stdio.h>
int main(void){
    int a[] = {2,0,2,1,1,0,2,1,0}; int n = 9;
    int lo = 0, mid = 0, hi = n - 1;
    while (mid <= hi){
        if (a[mid] == 0){ int t = a[lo]; a[lo] = a[mid]; a[mid] = t; ++lo; ++mid; }
        else if (a[mid] == 1){ ++mid; }
        else { int t = a[mid]; a[mid] = a[hi]; a[hi] = t; --hi; }
    }
    for (int i = 0; i < n; ++i) printf("%d", a[i]); printf("\n");
    return 0;
}
```

Expected: `000111222\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-058 — Prefix sum range query

Tags: c, dsa, array, prefix-sum · Flags: default.

```c
#include <stdio.h>
int main(void){
    int a[] = {3,1,4,1,5,9,2,6}; int n = 8;
    int pre[9]; pre[0] = 0;
    for (int i = 0; i < n; ++i) pre[i + 1] = pre[i] + a[i];
    int l = 2, r = 5; /* sum a[l..r] = pre[r+1]-pre[l] */
    printf("sum[%d..%d]=%d total=%d\n", l, r, pre[r + 1] - pre[l], pre[n]);
    return 0;
}
```

Expected: `sum[2..5]=19 total=31\n`. Pass: [ ] Output đúng.

---

## Section LINKED LIST (TC-C-DS-059 → TC-C-DS-063)

### TC-C-DS-059 — Reverse singly linked list (iterative) 🐞

Tags: c, dsa, linkedlist, reverse, debug · Flags: **debug `-g -O0`** (cho Debug step); Run dùng default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int val; struct Node* next; } Node;
static Node* push(Node* head, int v){ Node* n = malloc(sizeof(Node)); n->val = v; n->next = head; return n; }
static Node* reverse(Node* head){
    Node* prev = NULL;
    while (head){ Node* nx = head->next; head->next = prev; prev = head; head = nx; }
    return prev;
}
int main(void){
    Node* h = NULL;
    for (int i = 1; i <= 5; ++i) h = push(h, i); /* list: 5 4 3 2 1 */
    h = reverse(h);                              /* list: 1 2 3 4 5 */
    for (Node* p = h; p; p = p->next) printf("%d ", p->val); printf("\n");
    return 0;
}
```

UI (Run): C → Paste → Run.
Expected: `1 2 3 4 5 \n`.
UI (Debug): đặt breakpoint ở dòng đầu thân `while` trong `reverse` (gutter click) → **Debug** → **Step Over** vài vòng.
Pass: [ ] Run output đúng · [ ] Debug dừng đúng breakpoint · [ ] Watch `prev` / `head` cập nhật mỗi step (con trỏ đổi).
Notes: showcase con trỏ đảo chiều từng nút.

---

### TC-C-DS-060 — Floyd cycle detection (tortoise & hare)

Tags: c, dsa, linkedlist, cycle · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int val; struct Node* next; } Node;
int main(void){
    Node* nodes[5];
    for (int i = 0; i < 5; ++i){ nodes[i] = malloc(sizeof(Node)); nodes[i]->val = i + 1; }
    for (int i = 0; i < 4; ++i) nodes[i]->next = nodes[i + 1];
    nodes[4]->next = nodes[2]; /* tạo chu trình: 5 -> 3 */
    Node* slow = nodes[0]; Node* fast = nodes[0]; int has_cycle = 0;
    while (fast && fast->next){ slow = slow->next; fast = fast->next->next; if (slow == fast){ has_cycle = 1; break; } }
    printf("cycle=%d\n", has_cycle);
    return 0;
}
```

Expected: `cycle=1\n`. Pass: [ ] Output đúng · [ ] Không treo.

---

### TC-C-DS-061 — Merge two sorted lists

Tags: c, dsa, linkedlist, merge · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int val; struct Node* next; } Node;
static Node* mk(int v){ Node* n = malloc(sizeof(Node)); n->val = v; n->next = NULL; return n; }
int main(void){
    int A[] = {1,3,5}, B[] = {2,4,6};
    Node *a = NULL, **ta = &a; for (int i = 0; i < 3; ++i){ *ta = mk(A[i]); ta = &(*ta)->next; }
    Node *b = NULL, **tb = &b; for (int i = 0; i < 3; ++i){ *tb = mk(B[i]); tb = &(*tb)->next; }
    Node dummy; dummy.next = NULL; Node* tail = &dummy;
    while (a && b){ if (a->val <= b->val){ tail->next = a; a = a->next; } else { tail->next = b; b = b->next; } tail = tail->next; }
    tail->next = a ? a : b;
    for (Node* p = dummy.next; p; p = p->next) printf("%d ", p->val); printf("\n");
    return 0;
}
```

Expected: `1 2 3 4 5 6 \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-062 — Find middle node (slow/fast)

Tags: c, dsa, linkedlist, middle · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int val; struct Node* next; } Node;
static Node* mk(int v){ Node* n = malloc(sizeof(Node)); n->val = v; n->next = NULL; return n; }
int main(void){
    Node *h = NULL, **t = &h;
    for (int i = 1; i <= 7; ++i){ *t = mk(i); t = &(*t)->next; }
    Node *slow = h, *fast = h;
    while (fast && fast->next){ slow = slow->next; fast = fast->next->next; }
    printf("middle=%d\n", slow->val);
    return 0;
}
```

Expected: `middle=4\n` (danh sách 1..7). Pass: [ ] Output đúng.

---

### TC-C-DS-063 — Remove n-th node from end

Tags: c, dsa, linkedlist, remove · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int val; struct Node* next; } Node;
static Node* mk(int v){ Node* n = malloc(sizeof(Node)); n->val = v; n->next = NULL; return n; }
int main(void){
    Node dummy; Node* t = &dummy;
    for (int i = 1; i <= 5; ++i){ t->next = mk(i); t = t->next; }
    int k = 2;
    Node* fast = &dummy; for (int i = 0; i <= k; ++i) fast = fast->next; /* tiến k+1 bước */
    Node* slow = &dummy;
    while (fast){ fast = fast->next; slow = slow->next; }
    slow->next = slow->next->next; /* xóa node thứ k từ cuối */
    for (Node* p = dummy.next; p; p = p->next) printf("%d ", p->val); printf("\n");
    return 0;
}
```

Expected: `1 2 3 5 \n` (xóa node giá trị 4 — thứ 2 từ cuối). Pass: [ ] Output đúng.

---

## Section STACK / QUEUE (TC-C-DS-064 → TC-C-DS-068)

### TC-C-DS-064 — Balanced parentheses (stack)

Tags: c, dsa, stack, parens · Flags: default.

```c
#include <stdio.h>
static int balanced(const char* s){
    char st[256]; int top = 0;
    for (const char* p = s; *p; ++p){
        char c = *p;
        if (c == '(' || c == '[' || c == '{') st[top++] = c;
        else if (c == ')' || c == ']' || c == '}'){
            if (top == 0) return 0;
            char o = st[--top];
            if ((c == ')' && o != '(') || (c == ']' && o != '[') || (c == '}' && o != '{')) return 0;
        }
    }
    return top == 0;
}
int main(void){
    printf("%d %d %d\n", balanced("({[]})"), balanced("([)]"), balanced("((("));
    return 0;
}
```

Expected: `1 0 0\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-065 — Evaluate Reverse Polish Notation

Tags: c, dsa, stack, rpn · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){
    const char* toks[] = {"3","4","+","2","*"}; int n = 5;
    long st[64]; int top = 0;
    for (int i = 0; i < n; ++i){
        const char* t = toks[i];
        if (strcmp(t,"+") == 0 || strcmp(t,"-") == 0 || strcmp(t,"*") == 0 || strcmp(t,"/") == 0){
            long b = st[--top], a = st[--top], r = 0;
            switch (t[0]){ case '+': r = a + b; break; case '-': r = a - b; break; case '*': r = a * b; break; case '/': r = a / b; break; }
            st[top++] = r;
        } else st[top++] = atol(t);
    }
    printf("result=%ld\n", st[0]);
    return 0;
}
```

Expected: `result=14\n` (`(3+4)*2`). Pass: [ ] Output đúng.

---

### TC-C-DS-066 — Queue via two stacks (amortized)

Tags: c, dsa, queue, two-stacks · Flags: default.

```c
#include <stdio.h>
#define N 64
static int in_s[N], out_s[N]; static int in_t = 0, out_t = 0;
static void enq(int x){ in_s[in_t++] = x; }
static int deq(void){
    if (out_t == 0) while (in_t > 0) out_s[out_t++] = in_s[--in_t];
    return out_s[--out_t];
}
int main(void){
    enq(1); enq(2); enq(3);
    int a = deq();        /* 1 */
    enq(4);
    int b = deq(), c = deq(), d = deq(); /* 2 3 4 (khai báo nhiều biến → tuần tự trái→phải) */
    printf("%d %d %d %d\n", a, b, c, d);
    return 0;
}
```

Expected: `1 2 3 4\n` (FIFO). Pass: [ ] Output đúng.
Notes: tách `deq()` thành biến riêng để tránh thứ tự đánh giá tham số `printf` không xác định.

---

### TC-C-DS-067 — Monotonic stack: next greater element

Tags: c, dsa, stack, monotonic · Flags: default.

```c
#include <stdio.h>
int main(void){
    int a[] = {2,1,2,4,3}; int n = 5; int nge[5], st[5]; int top = 0;
    for (int i = n - 1; i >= 0; --i){
        while (top > 0 && st[top - 1] <= a[i]) --top;
        nge[i] = (top > 0) ? st[top - 1] : -1;
        st[top++] = a[i];
    }
    for (int i = 0; i < n; ++i) printf("%d ", nge[i]); printf("\n");
    return 0;
}
```

Expected: `4 2 4 -1 -1 \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-068 — Min-stack with O(1) getMin

Tags: c, dsa, stack, min-stack · Flags: default.

```c
#include <stdio.h>
#define N 64
static int st[N], mn[N]; static int top = 0;
static void push(int x){ st[top] = x; mn[top] = (top == 0) ? x : (x < mn[top - 1] ? x : mn[top - 1]); ++top; }
static int pop(void){ return st[--top]; }
static int getmin(void){ return mn[top - 1]; }
int main(void){
    int seq[] = {5,3,7,2};
    for (int i = 0; i < 4; ++i){ push(seq[i]); printf("push %d min=%d\n", seq[i], getmin()); }
    pop();
    printf("after pop min=%d\n", getmin());
    return 0;
}
```

Expected:
```
push 5 min=5
push 3 min=3
push 7 min=3
push 2 min=2
after pop min=3
```
Pass: [ ] Output đúng.

---

## Section TREE / BST (TC-C-DS-069 → TC-C-DS-075)

### TC-C-DS-069 — BST insert + inorder (sorted output)

Tags: c, dsa, tree, bst, inorder · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int key; struct Node *l, *r; } Node;
static Node* insert(Node* root, int k){
    if (!root){ Node* n = malloc(sizeof(Node)); n->key = k; n->l = n->r = NULL; return n; }
    if (k < root->key) root->l = insert(root->l, k);
    else root->r = insert(root->r, k);
    return root;
}
static void inorder(const Node* n){ if (!n) return; inorder(n->l); printf("%d ", n->key); inorder(n->r); }
int main(void){
    int ks[] = {5,3,8,1,4,7,9}; Node* root = NULL;
    for (int i = 0; i < 7; ++i) root = insert(root, ks[i]);
    inorder(root); printf("\n");
    return 0;
}
```

Expected: `1 3 4 5 7 8 9 \n`. Pass: [ ] Output sorted đúng.

---

### TC-C-DS-070 — BST search (iterative)

Tags: c, dsa, tree, bst, search · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int key; struct Node *l, *r; } Node;
static Node* insert(Node* r, int k){ if (!r){ Node* n = malloc(sizeof(Node)); n->key = k; n->l = n->r = NULL; return n; } if (k < r->key) r->l = insert(r->l, k); else r->r = insert(r->r, k); return r; }
static int search(const Node* r, int k){ while (r){ if (k == r->key) return 1; r = (k < r->key) ? r->l : r->r; } return 0; }
int main(void){
    int ks[] = {5,3,8,1,4,7,9}; Node* root = NULL;
    for (int i = 0; i < 7; ++i) root = insert(root, ks[i]);
    printf("find7=%d find6=%d\n", search(root, 7), search(root, 6));
    return 0;
}
```

Expected: `find7=1 find6=0\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-071 — Tree max-depth (recursion) 🐞

Tags: c, dsa, tree, recursion, debug · Flags: **debug `-g -O0`** cho Debug; Run dùng default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int key; struct Node *l, *r; } Node;
static Node* insert(Node* r, int k){ if (!r){ Node* n = malloc(sizeof(Node)); n->key = k; n->l = n->r = NULL; return n; } if (k < r->key) r->l = insert(r->l, k); else r->r = insert(r->r, k); return r; }
static int depth(const Node* n){ if (!n) return 0; int dl = depth(n->l), dr = depth(n->r); return 1 + (dl > dr ? dl : dr); }
int main(void){
    int ks[] = {5,3,8,1,4,7,9}; Node* root = NULL;
    for (int i = 0; i < 7; ++i) root = insert(root, ks[i]);
    printf("height=%d\n", depth(root));
    return 0;
}
```

UI (Run): Run.
Expected: `height=3\n`.
UI (Debug): breakpoint ở dòng `int dl = depth(n->l), ...` trong `depth` → **Debug** → **Step Into** để đi sâu đệ quy.
Pass: [ ] Run output đúng · [ ] Call Stack hiện nhiều frame `depth` lồng nhau · [ ] Watch `dl`/`dr` đúng khi quay lui.

---

### TC-C-DS-072 — Level-order BFS traversal

Tags: c, dsa, tree, bfs · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int key; struct Node *l, *r; } Node;
static Node* insert(Node* r, int k){ if (!r){ Node* n = malloc(sizeof(Node)); n->key = k; n->l = n->r = NULL; return n; } if (k < r->key) r->l = insert(r->l, k); else r->r = insert(r->r, k); return r; }
int main(void){
    int ks[] = {5,3,8,1,4,7,9}; Node* root = NULL;
    for (int i = 0; i < 7; ++i) root = insert(root, ks[i]);
    const Node* q[16]; int head = 0, tail = 0;
    q[tail++] = root;
    while (head < tail){
        const Node* n = q[head++];
        printf("%d ", n->key);
        if (n->l) q[tail++] = n->l;
        if (n->r) q[tail++] = n->r;
    }
    printf("\n");
    return 0;
}
```

Expected: `5 3 8 1 4 7 9 \n`. Pass: [ ] Output đúng theo tầng.

---

### TC-C-DS-073 — Validate BST (min/max bounds)

Tags: c, dsa, tree, validate · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
#include <limits.h>
typedef struct Node { int key; struct Node *l, *r; } Node;
static Node* mk(int k){ Node* n = malloc(sizeof(Node)); n->key = k; n->l = n->r = NULL; return n; }
static int valid(const Node* n, long lo, long hi){
    if (!n) return 1;
    if (n->key <= lo || n->key >= hi) return 0;
    return valid(n->l, lo, n->key) && valid(n->r, n->key, hi);
}
int main(void){
    Node* a = mk(5); a->l = mk(3); a->r = mk(8);  /* hợp lệ */
    Node* b = mk(5); b->l = mk(6); b->r = mk(8);  /* sai: con trái 6 > 5 */
    printf("a=%d b=%d\n", valid(a, LONG_MIN, LONG_MAX), valid(b, LONG_MIN, LONG_MAX));
    return 0;
}
```

Expected: `a=1 b=0\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-074 — Lowest common ancestor in BST

Tags: c, dsa, tree, lca · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int key; struct Node *l, *r; } Node;
static Node* insert(Node* r, int k){ if (!r){ Node* n = malloc(sizeof(Node)); n->key = k; n->l = n->r = NULL; return n; } if (k < r->key) r->l = insert(r->l, k); else r->r = insert(r->r, k); return r; }
static int lca(const Node* r, int a, int b){
    while (r){ if (a < r->key && b < r->key) r = r->l; else if (a > r->key && b > r->key) r = r->r; else return r->key; }
    return -1;
}
int main(void){
    int ks[] = {5,3,8,1,4,7,9}; Node* root = NULL;
    for (int i = 0; i < 7; ++i) root = insert(root, ks[i]);
    printf("lca(1,4)=%d lca(7,9)=%d lca(3,8)=%d\n", lca(root, 1, 4), lca(root, 7, 9), lca(root, 3, 8));
    return 0;
}
```

Expected: `lca(1,4)=3 lca(7,9)=8 lca(3,8)=5\n`. Pass: [ ] Output đúng.

---

### TC-C-DS-075 — Pre / in / post-order traversal

Tags: c, dsa, tree, traversal · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct Node { int v; struct Node *l, *r; } Node;
static Node* mk(int v){ Node* n = malloc(sizeof(Node)); n->v = v; n->l = n->r = NULL; return n; }
static void pre(const Node* n){ if (!n) return; printf("%d ", n->v); pre(n->l); pre(n->r); }
static void ino(const Node* n){ if (!n) return; ino(n->l); printf("%d ", n->v); ino(n->r); }
static void post(const Node* n){ if (!n) return; post(n->l); post(n->r); printf("%d ", n->v); }
int main(void){
    Node* root = mk(1); root->l = mk(2); root->r = mk(3); root->l->l = mk(4); root->l->r = mk(5);
    pre(root); printf("\n"); ino(root); printf("\n"); post(root); printf("\n");
    return 0;
}
```

Expected:
```
1 2 4 5 3 
4 2 5 1 3 
4 5 2 3 1 
```
Pass: [ ] Cả 3 thứ tự đúng.

---

## Section HEAP (TC-C-DS-076 → TC-C-DS-078)

### TC-C-DS-076 — Heapsort (max-heap, ascending)

Tags: c, dsa, heap, heapsort · Flags: default.

```c
#include <stdio.h>
static void sift_down(int* a, int n, int i){
    for (;;){
        int l = 2*i + 1, r = 2*i + 2, big = i;
        if (l < n && a[l] > a[big]) big = l;
        if (r < n && a[r] > a[big]) big = r;
        if (big == i) break;
        int t = a[i]; a[i] = a[big]; a[big] = t; i = big;
    }
}
int main(void){
    int a[] = {5,3,8,1,9,2,7}; int n = 7;
    for (int i = n/2 - 1; i >= 0; --i) sift_down(a, n, i);
    for (int end = n - 1; end > 0; --end){ int t = a[0]; a[0] = a[end]; a[end] = t; sift_down(a, end, 0); }
    for (int i = 0; i < n; ++i) printf("%d ", a[i]); printf("\n");
    return 0;
}
```

Expected: `1 2 3 5 7 8 9 \n`. Pass: [ ] Output sorted tăng dần.

---

### TC-C-DS-077 — K-th largest (size-k min-heap)

Tags: c, dsa, heap, kth · Flags: default.

```c
#include <stdio.h>
static void sift_up(int* h, int i){ while (i > 0){ int p = (i - 1) / 2; if (h[p] <= h[i]) break; int t = h[p]; h[p] = h[i]; h[i] = t; i = p; } }
static void sift_down(int* h, int n, int i){ for (;;){ int l = 2*i+1, r = 2*i+2, sm = i; if (l < n && h[l] < h[sm]) sm = l; if (r < n && h[r] < h[sm]) sm = r; if (sm == i) break; int t = h[i]; h[i] = h[sm]; h[sm] = t; i = sm; } }
int main(void){
    int a[] = {3,2,1,5,6,4}; int n = 6, k = 2;
    int h[8]; int hn = 0;
    for (int i = 0; i < n; ++i){
        if (hn < k){ h[hn++] = a[i]; sift_up(h, hn - 1); }
        else if (a[i] > h[0]){ h[0] = a[i]; sift_down(h, hn, 0); }
    }
    printf("kth=%d\n", h[0]);
    return 0;
}
```

Expected: `kth=5\n` (lớn thứ 2). Pass: [ ] Output đúng.

---

### TC-C-DS-078 — Heapify (build max-heap via sift-down)

Tags: c, dsa, heap, heapify · Flags: default.

```c
#include <stdio.h>
static void sift_down(int* a, int n, int i){
    for (;;){ int l = 2*i+1, r = 2*i+2, big = i;
        if (l < n && a[l] > a[big]) big = l; if (r < n && a[r] > a[big]) big = r;
        if (big == i) break; int t = a[i]; a[i] = a[big]; a[big] = t; i = big; }
}
int main(void){
    int a[] = {3,1,6,5,2,4}; int n = 6;
    for (int i = n/2 - 1; i >= 0; --i) sift_down(a, n, i);
    printf("root=%d\n", a[0]);
    for (int i = 0; i < n; ++i) printf("%d ", a[i]); printf("\n");
    return 0;
}
```

Expected: `root=6\n6 5 4 1 2 3 \n` (root = max; thứ tự mảng theo thuật toán này deterministic).
Pass: [ ] root=6 · [ ] Mảng là max-heap hợp lệ (a[i] ≥ con).

---

## Section GRAPH (TC-C-DS-079 → TC-C-DS-085)

### TC-C-DS-079 — Adjacency list build + print

Tags: c, dsa, graph, adjlist · Flags: default.

```c
#include <stdio.h>
#include <stdlib.h>
typedef struct E { int to; struct E* next; } E;
int main(void){
    int V = 4; E* adj[4] = {0};
    int edges[][2] = {{0,1},{0,2},{1,2},{2,3}};
    for (int i = 0; i < 4; ++i){ int u = edges[i][0], v = edges[i][1]; E* e = malloc(sizeof(E)); e->to = v; e->next = adj[u]; adj[u] = e; }
    for (int u = 0; u < V; ++u){ printf("%d:", u); for (E* e = adj[u]; e; e = e->next) printf(" %d", e->to); printf("\n"); }
    return 0;
}
```

Expected (head-insert ⇒ neighbor in nghịch thứ tự thêm):
```
0: 2 1
1: 2
2: 3
3:
```
Pass: [ ] Output đúng.

---

### TC-C-DS-080 — BFS shortest path (unweighted)

Tags: c, dsa, graph, bfs · Flags: default.

```c
#include <stdio.h>
int main(void){
    int V = 6; int adj[6][6] = {0};
    int edges[][2] = {{0,1},{0,2},{1,3},{2,3},{3,4},{4,5}};
    for (int i = 0; i < 6; ++i){ int u = edges[i][0], v = edges[i][1]; adj[u][v] = adj[v][u] = 1; }
    int dist[6]; for (int i = 0; i < 6; ++i) dist[i] = -1;
    int q[6], head = 0, tail = 0; q[tail++] = 0; dist[0] = 0;
    while (head < tail){ int u = q[head++]; for (int v = 0; v < V; ++v) if (adj[u][v] && dist[v] == -1){ dist[v] = dist[u] + 1; q[tail++] = v; } }
    for (int i = 0; i < V; ++i) printf("d[%d]=%d ", i, dist[i]); printf("\n");
    return 0;
}
```

Expected: `d[0]=0 d[1]=1 d[2]=1 d[3]=2 d[4]=3 d[5]=4 \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-081 — DFS recursive + visited 🐞

Tags: c, dsa, graph, dfs, debug · Flags: **debug `-g -O0`** cho Debug; Run dùng default.

```c
#include <stdio.h>
static int adj[6][6] = {0};
static int visited[6] = {0};
static int V = 6;
static void dfs(int u){
    visited[u] = 1; printf("%d ", u);
    for (int v = 0; v < V; ++v) if (adj[u][v] && !visited[v]) dfs(v);
}
int main(void){
    int edges[][2] = {{0,1},{0,2},{1,3},{2,3},{3,4},{4,5}};
    for (int i = 0; i < 6; ++i){ int u = edges[i][0], v = edges[i][1]; adj[u][v] = adj[v][u] = 1; }
    dfs(0); printf("\n");
    return 0;
}
```

UI (Run): Run.
Expected: `0 1 3 2 4 5 \n`.
UI (Debug): breakpoint ở dòng `visited[u] = 1; ...` trong `dfs` → **Debug** → **Continue** vài lần để xem đệ quy đào sâu.
Pass: [ ] Run output đúng · [ ] Call Stack tăng độ sâu theo nhánh DFS · [ ] Expand mảng `visited[]` thấy bit bật dần.

---

### TC-C-DS-082 — Topological sort (Kahn's algorithm)

Tags: c, dsa, graph, toposort · Flags: default.

```c
#include <stdio.h>
int main(void){
    int V = 6; int adj[6][6] = {0}; int indeg[6] = {0};
    int edges[][2] = {{5,2},{5,0},{4,0},{4,1},{2,3},{3,1}};
    for (int i = 0; i < 6; ++i){ int u = edges[i][0], v = edges[i][1]; adj[u][v] = 1; indeg[v]++; }
    int q[6], head = 0, tail = 0;
    for (int i = 0; i < V; ++i) if (indeg[i] == 0) q[tail++] = i;
    while (head < tail){
        int u = q[head++]; printf("%d ", u);
        for (int v = 0; v < V; ++v) if (adj[u][v] && --indeg[v] == 0) q[tail++] = v;
    }
    printf("\n");
    return 0;
}
```

Expected: `4 5 0 2 3 1 \n` (một topo-order hợp lệ; deterministic theo Kahn + quét chỉ số tăng).
Pass: [ ] Output đúng thứ tự này.

---

### TC-C-DS-083 — Union-Find (DSU) + path compression 🐞

Tags: c, dsa, graph, dsu, debug · Flags: **debug `-g -O0`** cho Debug; Run dùng default.

```c
#include <stdio.h>
static int parent[10], rnk[10];
static int find(int x){ while (parent[x] != x){ parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
static void uni(int a, int b){
    int ra = find(a), rb = find(b);
    if (ra == rb) return;
    if (rnk[ra] < rnk[rb]){ int t = ra; ra = rb; rb = t; }
    parent[rb] = ra; if (rnk[ra] == rnk[rb]) rnk[ra]++;
}
int main(void){
    int n = 6; for (int i = 0; i < n; ++i){ parent[i] = i; rnk[i] = 0; }
    uni(0,1); uni(1,2); uni(3,4);
    printf("same(0,2)=%d same(0,3)=%d\n", find(0) == find(2), find(0) == find(3));
    int comp = 0; for (int i = 0; i < n; ++i) if (find(i) == i) ++comp;
    printf("components=%d\n", comp);
    return 0;
}
```

UI (Run): Run.
Expected: `same(0,2)=1 same(0,3)=0\ncomponents=3\n`.
UI (Debug): breakpoint ở `parent[rb] = ra;` trong `uni` → **Debug** → **Step Over**, expand mảng `parent[]`.
Pass: [ ] Run output đúng · [ ] Expand `parent[]` thấy gốc gộp dần · [ ] Watch `find(0)`/`find(2)` ra cùng gốc.

---

### TC-C-DS-084 — Dijkstra (array select-min)

Tags: c, dsa, graph, dijkstra · Flags: default.

```c
#include <stdio.h>
#include <limits.h>
int main(void){
    int V = 5; int INF = INT_MAX; int w[5][5];
    for (int i = 0; i < 5; ++i) for (int j = 0; j < 5; ++j) w[i][j] = (i == j) ? 0 : INF;
    int e[][3] = {{0,1,4},{0,2,1},{2,1,2},{1,3,1},{2,3,5},{3,4,3}};
    for (int i = 0; i < 6; ++i){ int u = e[i][0], v = e[i][1], c = e[i][2]; w[u][v] = c; }
    int dist[5], done[5] = {0};
    for (int i = 0; i < 5; ++i) dist[i] = INF; dist[0] = 0;
    for (int it = 0; it < V; ++it){
        int u = -1; for (int i = 0; i < V; ++i) if (!done[i] && dist[i] != INF && (u == -1 || dist[i] < dist[u])) u = i;
        if (u == -1) break; done[u] = 1;
        for (int v = 0; v < V; ++v) if (w[u][v] != INF && dist[u] + w[u][v] < dist[v]) dist[v] = dist[u] + w[u][v];
    }
    for (int i = 0; i < V; ++i) printf("d%d=%d ", i, dist[i]); printf("\n");
    return 0;
}
```

Expected: `d0=0 d1=3 d2=1 d3=4 d4=7 \n` (đồ thị có hướng; 0→2→1 rẻ hơn 0→1). Pass: [ ] Output đúng.

---

### TC-C-DS-085 — Directed cycle detection (DFS 3-color)

Tags: c, dsa, graph, cycle, color · Flags: default.

```c
#include <stdio.h>
static int adj[5][5] = {0};
static int color[5] = {0}; /* 0=white, 1=gray, 2=black */
static int V = 5;
static int has_cycle_dfs(int u){
    color[u] = 1;
    for (int v = 0; v < V; ++v) if (adj[u][v]){
        if (color[v] == 1) return 1;
        if (color[v] == 0 && has_cycle_dfs(v)) return 1;
    }
    color[u] = 2; return 0;
}
int main(void){
    int e[][2] = {{0,1},{1,2},{2,0},{3,4}}; /* chu trình 0->1->2->0 */
    for (int i = 0; i < 4; ++i) adj[e[i][0]][e[i][1]] = 1;
    int found = 0;
    for (int i = 0; i < V; ++i) if (color[i] == 0 && has_cycle_dfs(i)){ found = 1; break; }
    printf("cycle=%d\n", found);
    return 0;
}
```

Expected: `cycle=1\n`. Pass: [ ] Output đúng.

---

## Section SORTING (TC-C-DS-086 → TC-C-DS-088)

### TC-C-DS-086 — Quicksort (Lomuto partition) 🐞

Tags: c, dsa, sort, quicksort, debug · Flags: **debug `-g -O0`** cho Debug; Run dùng default.

```c
#include <stdio.h>
static void swap(int* a, int* b){ int t = *a; *a = *b; *b = t; }
static int partition(int* arr, int lo, int hi){
    int pivot = arr[hi]; int i = lo - 1;
    for (int j = lo; j < hi; ++j) if (arr[j] < pivot){ ++i; swap(&arr[i], &arr[j]); }
    swap(&arr[i + 1], &arr[hi]); return i + 1;
}
static void quicksort(int* arr, int lo, int hi){ if (lo < hi){ int p = partition(arr, lo, hi); quicksort(arr, lo, p - 1); quicksort(arr, p + 1, hi); } }
int main(void){
    int a[] = {9,3,7,1,8,2,5}; int n = 7;
    quicksort(a, 0, n - 1);
    for (int i = 0; i < n; ++i) printf("%d ", a[i]); printf("\n");
    return 0;
}
```

UI (Run): Run.
Expected: `1 2 3 5 7 8 9 \n`.
UI (Debug): breakpoint ở `int pivot = arr[hi]; ...` trong `partition` → **Debug** → **Step Over**, watch `pivot`/`i`/`j`.
Pass: [ ] Run output đúng · [ ] Call Stack hiện `quicksort` lồng nhau · [ ] Expand mảng `arr` thấy thay đổi giữa các lần phân hoạch.

---

### TC-C-DS-087 — Mergesort (stable)

Tags: c, dsa, sort, mergesort · Flags: default.

```c
#include <stdio.h>
static void merge(int* a, int l, int m, int r, int* tmp){
    int i = l, j = m + 1, k = l;
    while (i <= m && j <= r) tmp[k++] = (a[i] <= a[j]) ? a[i++] : a[j++];
    while (i <= m) tmp[k++] = a[i++];
    while (j <= r) tmp[k++] = a[j++];
    for (int t = l; t <= r; ++t) a[t] = tmp[t];
}
static void msort(int* a, int l, int r, int* tmp){ if (l < r){ int m = (l + r) / 2; msort(a, l, m, tmp); msort(a, m + 1, r, tmp); merge(a, l, m, r, tmp); } }
int main(void){
    int a[] = {5,2,9,1,6,3}; int n = 6; int tmp[6];
    msort(a, 0, n - 1, tmp);
    for (int i = 0; i < n; ++i) printf("%d ", a[i]); printf("\n");
    return 0;
}
```

Expected: `1 2 3 5 6 9 \n`. Pass: [ ] Output đúng.

---

### TC-C-DS-088 — Counting sort (non-negative range)

Tags: c, dsa, sort, counting · Flags: default.

```c
#include <stdio.h>
int main(void){
    int a[] = {4,2,2,8,3,3,1}; int n = 7, maxv = 8;
    int cnt[9] = {0};
    for (int i = 0; i < n; ++i) cnt[a[i]]++;
    int idx = 0;
    for (int v = 0; v <= maxv; ++v) while (cnt[v]-- > 0) a[idx++] = v;
    for (int i = 0; i < n; ++i) printf("%d ", a[i]); printf("\n");
    return 0;
}
```

Expected: `1 2 2 3 3 4 8 \n`. Pass: [ ] Output đúng.

---

## Section BACKTRACKING / DP (TC-C-DS-089 → TC-C-DS-090)

### TC-C-DS-089 — N-Queens count (backtracking)

Tags: c, dsa, backtracking, nqueens · Flags: default.

```c
#include <stdio.h>
#define N 8
static int count = 0;
static int cols[N], d1[2*N], d2[2*N];
static void solve(int r){
    if (r == N){ ++count; return; }
    for (int c = 0; c < N; ++c){
        int i = r + c, j = r - c + N;
        if (!cols[c] && !d1[i] && !d2[j]){
            cols[c] = d1[i] = d2[j] = 1;
            solve(r + 1);
            cols[c] = d1[i] = d2[j] = 0;
        }
    }
}
int main(void){ solve(0); printf("solutions=%d\n", count); return 0; }
```

Expected: `solutions=92\n` (số lời giải 8-queens). Pass: [ ] Output đúng.
Notes: chạy nhanh < 1s; phủ đệ quy + cắt nhánh.

---

### TC-C-DS-090 — 0/1 Knapsack (1-D DP)

Tags: c, dsa, dp, knapsack · Flags: default.

```c
#include <stdio.h>
int main(void){
    int w[] = {1,3,4,5}, val[] = {1,4,5,7}; int n = 4, cap = 7;
    int dp[8] = {0}; /* dp[c] = giá trị tốt nhất với sức chứa c */
    for (int i = 0; i < n; ++i)
        for (int c = cap; c >= w[i]; --c){ int cand = dp[c - w[i]] + val[i]; if (cand > dp[c]) dp[c] = cand; }
    printf("best=%d\n", dp[cap]);
    return 0;
}
```

Expected: `best=9\n` (chọn vật w=3,v=4 + w=4,v=5). Pass: [ ] Output đúng.

---

## Tự kiểm trước khi commit

1. Mọi code block compile sạch: `gcc -std=gnu17 -O2 -Wall -Wextra -lm <file>` (debug-flagged scenario thêm `-g -O0`).
2. ID liên tục TC-C-DS-051 → TC-C-DS-090, không trùng với 001–050 ở [`c-embedded.md`](c-embedded.md).
3. 5 scenario 🐞 (059, 071, 081, 083, 086) có cả lối Run lẫn Debug + tiêu chí inspect.
4. Expected output đối chiếu khít với code (đã trace tay từng case).
