/**
 * algo-templates — algorithm code-sample data, keyed by algorithm name then language.
 *
 * Extracted verbatim from VaiEngine.algoTemplate (vai-engine.ts), where this
 * 224-entry table made the method 9,279 lines (~18% of the whole engine file).
 * Pure data: { [algo]: { [lang]: { title, code, desc } } }. The lookup logic stays
 * in algoTemplate, which now reads from ALGO_TEMPLATES. Kept byte-identical to the
 * original (proven by scripts/capture-algo-golden.mjs).
 */
/* eslint-disable */

export type AlgoTemplateTable = Record<string, Record<string, { title: string; code: string; desc: string }>>;

export const ALGO_TEMPLATES: AlgoTemplateTable = {
      // ─── SORTING ───
      binary_search: {
        python: {
          title: 'Binary Search',
          code: `\`\`\`python
def binary_search(arr, target):
    left, right = 0, len(arr) - 1
    while left <= right:
        mid = (left + right) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1

# Usage:
print(binary_search([1, 3, 5, 7, 9, 11], 7))  # 3
\`\`\``,
          desc: 'Binary search on a sorted array. Returns the index of the target, or -1 if not found. Time complexity: O(log n).',
        },
        javascript: {
          title: 'Binary Search',
          code: `\`\`\`javascript
function binarySearch(arr, target) {
  let left = 0;
  let right = arr.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] === target) return mid;
    else if (arr[mid] < target) left = mid + 1;
    else right = mid - 1;
  }
  return -1;
}

// Usage:
console.log(binarySearch([1, 3, 5, 7, 9, 11], 7)); // 3
\`\`\``,
          desc: 'Binary search on a sorted array. Returns the index of the target, or -1 if not found. Time complexity: O(log n).',
        },
      },
      bubble_sort: {
        python: {
          title: 'Bubble Sort',
          code: `\`\`\`python
def bubble_sort(arr):
    n = len(arr)
    for i in range(n):
        swapped = False
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        if not swapped:
            break
    return arr

# Usage:
print(bubble_sort([64, 34, 25, 12, 22, 11, 90]))
# [11, 12, 22, 25, 34, 64, 90]
\`\`\``,
          desc: 'Bubble sort with early termination optimization. Time complexity: O(n²), Space: O(1).',
        },
        javascript: {
          title: 'Bubble Sort',
          code: `\`\`\`javascript
function bubbleSort(arr) {
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    let swapped = false;
    for (let j = 0; j < n - i - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return arr;
}

// Usage:
console.log(bubbleSort([64, 34, 25, 12, 22, 11, 90]));
// [11, 12, 22, 25, 34, 64, 90]
\`\`\``,
          desc: 'Bubble sort with early termination optimization. Time complexity: O(n²), Space: O(1).',
        },
      },
      selection_sort: {
        python: {
          title: 'Selection Sort',
          code: `\`\`\`python
def selection_sort(arr):
    n = len(arr)
    for i in range(n):
        min_idx = i
        for j in range(i + 1, n):
            if arr[j] < arr[min_idx]:
                min_idx = j
        arr[i], arr[min_idx] = arr[min_idx], arr[i]
    return arr

# Usage:
print(selection_sort([64, 25, 12, 22, 11]))
# [11, 12, 22, 25, 64]
\`\`\``,
          desc: 'Selection sort — finds the minimum element and places it at the beginning. Time complexity: O(n²), Space: O(1).',
        },
        javascript: {
          title: 'Selection Sort',
          code: `\`\`\`javascript
function selectionSort(arr) {
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    let minIdx = i;
    for (let j = i + 1; j < n; j++) {
      if (arr[j] < arr[minIdx]) minIdx = j;
    }
    [arr[i], arr[minIdx]] = [arr[minIdx], arr[i]];
  }
  return arr;
}

// Usage:
console.log(selectionSort([64, 25, 12, 22, 11]));
// [11, 12, 22, 25, 64]
\`\`\``,
          desc: 'Selection sort — finds the minimum element and places it at the beginning. Time complexity: O(n²), Space: O(1).',
        },
      },
      insertion_sort: {
        python: {
          title: 'Insertion Sort',
          code: `\`\`\`python
def insertion_sort(arr):
    for i in range(1, len(arr)):
        key = arr[i]
        j = i - 1
        while j >= 0 and arr[j] > key:
            arr[j + 1] = arr[j]
            j -= 1
        arr[j + 1] = key
    return arr

# Usage:
print(insertion_sort([12, 11, 13, 5, 6]))
# [5, 6, 11, 12, 13]
\`\`\``,
          desc: 'Insertion sort — builds sorted array one element at a time. Time complexity: O(n²), Space: O(1). Best for small or nearly sorted data.',
        },
        javascript: {
          title: 'Insertion Sort',
          code: `\`\`\`javascript
function insertionSort(arr) {
  for (let i = 1; i < arr.length; i++) {
    const key = arr[i];
    let j = i - 1;
    while (j >= 0 && arr[j] > key) {
      arr[j + 1] = arr[j];
      j--;
    }
    arr[j + 1] = key;
  }
  return arr;
}

// Usage:
console.log(insertionSort([12, 11, 13, 5, 6]));
// [5, 6, 11, 12, 13]
\`\`\``,
          desc: 'Insertion sort — builds sorted array one element at a time. Time complexity: O(n²), Space: O(1). Best for small or nearly sorted data.',
        },
      },
      merge_sort: {
        python: {
          title: 'Merge Sort',
          code: `\`\`\`python
def merge_sort(arr):
    if len(arr) <= 1:
        return arr
    mid = len(arr) // 2
    left = merge_sort(arr[:mid])
    right = merge_sort(arr[mid:])
    return merge(left, right)

def merge(left, right):
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i])
            i += 1
        else:
            result.append(right[j])
            j += 1
    result.extend(left[i:])
    result.extend(right[j:])
    return result

# Usage:
print(merge_sort([38, 27, 43, 3, 9, 82, 10]))
# [3, 9, 10, 27, 38, 43, 82]
\`\`\``,
          desc: 'Merge sort — divide-and-conquer algorithm. Time complexity: O(n log n), Space: O(n). Stable sort.',
        },
        javascript: {
          title: 'Merge Sort',
          code: `\`\`\`javascript
function mergeSort(arr) {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  const left = mergeSort(arr.slice(0, mid));
  const right = mergeSort(arr.slice(mid));
  return merge(left, right);
}

function merge(left, right) {
  const result = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) result.push(left[i++]);
    else result.push(right[j++]);
  }
  return result.concat(left.slice(i), right.slice(j));
}

// Usage:
console.log(mergeSort([38, 27, 43, 3, 9, 82, 10]));
// [3, 9, 10, 27, 38, 43, 82]
\`\`\``,
          desc: 'Merge sort — divide-and-conquer algorithm. Time complexity: O(n log n), Space: O(n). Stable sort.',
        },
      },
      // ─── RECURSION ───
      factorial_recursive: {
        python: {
          title: 'Recursive Factorial',
          code: `\`\`\`python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

# Usage:
print(factorial(5))   # 120
print(factorial(10))  # 3628800
\`\`\``,
          desc: 'Recursive factorial function. Base case: n <= 1 returns 1. Recursive case: n * factorial(n-1).',
        },
        javascript: {
          title: 'Recursive Factorial',
          code: `\`\`\`javascript
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

// Usage:
console.log(factorial(5));   // 120
console.log(factorial(10));  // 3628800
\`\`\``,
          desc: 'Recursive factorial function. Base case: n <= 1 returns 1. Recursive case: n * factorial(n-1).',
        },
      },
      fibonacci_recursive: {
        python: {
          title: 'Recursive Fibonacci',
          code: `\`\`\`python
def fibonacci(n):
    if n <= 0:
        return 0
    if n == 1:
        return 1
    return fibonacci(n - 1) + fibonacci(n - 2)

# Usage:
for i in range(10):
    print(fibonacci(i), end=' ')
# 0 1 1 2 3 5 8 13 21 34
\`\`\``,
          desc: 'Recursive Fibonacci function. Base cases: fib(0)=0, fib(1)=1. Recursive: fib(n-1) + fib(n-2). Time: O(2^n).',
        },
        javascript: {
          title: 'Recursive Fibonacci',
          code: `\`\`\`javascript
function fibonacci(n) {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// Usage:
for (let i = 0; i < 10; i++) {
  process.stdout.write(fibonacci(i) + ' ');
}
// 0 1 1 2 3 5 8 13 21 34
\`\`\``,
          desc: 'Recursive Fibonacci function. Base cases: fib(0)=0, fib(1)=1. Recursive: fib(n-1) + fib(n-2). Time: O(2^n).',
        },
      },
      gcd_recursive: {
        python: {
          title: 'Recursive GCD (Euclidean Algorithm)',
          code: `\`\`\`python
def gcd(a, b):
    if b == 0:
        return a
    return gcd(b, a % b)

# Usage:
print(gcd(48, 18))   # 6
print(gcd(56, 98))   # 14
\`\`\``,
          desc: 'Recursive GCD using the Euclidean algorithm. Base case: b=0 returns a. Recursive: gcd(b, a%b).',
        },
        javascript: {
          title: 'Recursive GCD (Euclidean Algorithm)',
          code: `\`\`\`javascript
function gcd(a, b) {
  if (b === 0) return a;
  return gcd(b, a % b);
}

// Usage:
console.log(gcd(48, 18));  // 6
console.log(gcd(56, 98));  // 14
\`\`\``,
          desc: 'Recursive GCD using the Euclidean algorithm. Base case: b=0 returns a. Recursive: gcd(b, a%b).',
        },
      },
      power_recursive: {
        python: {
          title: 'Recursive Power Function',
          code: `\`\`\`python
def power(base, exp):
    if exp == 0:
        return 1
    if exp % 2 == 0:
        half = power(base, exp // 2)
        return half * half
    return base * power(base, exp - 1)

# Usage:
print(power(2, 10))  # 1024
print(power(3, 4))   # 81
\`\`\``,
          desc: 'Recursive power function with fast exponentiation. Uses the property: x^(2k) = (x^k)^2. Time: O(log n).',
        },
        javascript: {
          title: 'Recursive Power Function',
          code: `\`\`\`javascript
function power(base, exp) {
  if (exp === 0) return 1;
  if (exp % 2 === 0) {
    const half = power(base, Math.floor(exp / 2));
    return half * half;
  }
  return base * power(base, exp - 1);
}

// Usage:
console.log(power(2, 10));  // 1024
console.log(power(3, 4));   // 81
\`\`\``,
          desc: 'Recursive power function with fast exponentiation. Uses the property: x^(2k) = (x^k)^2. Time: O(log n).',
        },
      },
      // ─── DATA STRUCTURES ───
      stack_class: {
        python: {
          title: 'Stack Implementation',
          code: `\`\`\`python
class Stack:
    def __init__(self):
        self.items = []

    def push(self, item):
        self.items.append(item)

    def pop(self):
        if self.is_empty():
            raise IndexError("Stack is empty")
        return self.items.pop()

    def peek(self):
        if self.is_empty():
            raise IndexError("Stack is empty")
        return self.items[-1]

    def is_empty(self):
        return len(self.items) == 0

    def size(self):
        return len(self.items)

# Usage:
s = Stack()
s.push(1)
s.push(2)
s.push(3)
print(s.peek())   # 3
print(s.pop())    # 3
print(s.size())   # 2
\`\`\``,
          desc: 'Stack (LIFO) implementation using a list. Operations: push, pop, peek, is_empty, size. All O(1).',
        },
        javascript: {
          title: 'Stack Implementation',
          code: `\`\`\`javascript
class Stack {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
  }

  pop() {
    if (this.isEmpty()) throw new Error('Stack is empty');
    return this.items.pop();
  }

  peek() {
    if (this.isEmpty()) throw new Error('Stack is empty');
    return this.items[this.items.length - 1];
  }

  isEmpty() {
    return this.items.length === 0;
  }

  size() {
    return this.items.length;
  }
}

// Usage:
const s = new Stack();
s.push(1);
s.push(2);
s.push(3);
console.log(s.peek());  // 3
console.log(s.pop());   // 3
console.log(s.size());  // 2
\`\`\``,
          desc: 'Stack (LIFO) implementation using an array. Operations: push, pop, peek, isEmpty, size. All O(1).',
        },
      },
      queue_class: {
        python: {
          title: 'Queue Implementation',
          code: `\`\`\`python
class Queue:
    def __init__(self):
        self.items = []

    def enqueue(self, item):
        self.items.append(item)

    def dequeue(self):
        if self.is_empty():
            raise IndexError("Queue is empty")
        return self.items.pop(0)

    def peek(self):
        if self.is_empty():
            raise IndexError("Queue is empty")
        return self.items[0]

    def is_empty(self):
        return len(self.items) == 0

    def size(self):
        return len(self.items)

# Usage:
q = Queue()
q.enqueue(1)
q.enqueue(2)
q.enqueue(3)
print(q.peek())     # 1
print(q.dequeue())  # 1
print(q.size())     # 2
\`\`\``,
          desc: 'Queue (FIFO) implementation using a list. Operations: enqueue, dequeue, peek, is_empty, size.',
        },
        javascript: {
          title: 'Queue Implementation',
          code: `\`\`\`javascript
class Queue {
  constructor() {
    this.items = [];
  }

  enqueue(item) {
    this.items.push(item);
  }

  dequeue() {
    if (this.isEmpty()) throw new Error('Queue is empty');
    return this.items.shift();
  }

  peek() {
    if (this.isEmpty()) throw new Error('Queue is empty');
    return this.items[0];
  }

  isEmpty() {
    return this.items.length === 0;
  }

  size() {
    return this.items.length;
  }
}

// Usage:
const q = new Queue();
q.enqueue(1);
q.enqueue(2);
q.enqueue(3);
console.log(q.peek());     // 1
console.log(q.dequeue());  // 1
console.log(q.size());     // 2
\`\`\``,
          desc: 'Queue (FIFO) implementation using an array. Operations: enqueue, dequeue, peek, isEmpty, size.',
        },
      },
      bst_insert: {
        python: {
          title: 'Binary Search Tree',
          code: `\`\`\`python
class TreeNode:
    def __init__(self, val):
        self.val = val
        self.left = None
        self.right = None

class BST:
    def __init__(self):
        self.root = None

    def insert(self, val):
        if not self.root:
            self.root = TreeNode(val)
        else:
            self._insert(self.root, val)

    def _insert(self, node, val):
        if val < node.val:
            if node.left is None:
                node.left = TreeNode(val)
            else:
                self._insert(node.left, val)
        else:
            if node.right is None:
                node.right = TreeNode(val)
            else:
                self._insert(node.right, val)

    def search(self, val):
        return self._search(self.root, val)

    def _search(self, node, val):
        if node is None:
            return False
        if val == node.val:
            return True
        elif val < node.val:
            return self._search(node.left, val)
        else:
            return self._search(node.right, val)

    def inorder(self):
        result = []
        self._inorder(self.root, result)
        return result

    def _inorder(self, node, result):
        if node:
            self._inorder(node.left, result)
            result.append(node.val)
            self._inorder(node.right, result)

# Usage:
tree = BST()
for val in [5, 3, 7, 1, 4, 6, 8]:
    tree.insert(val)
print(tree.inorder())    # [1, 3, 4, 5, 6, 7, 8]
print(tree.search(4))    # True
print(tree.search(9))    # False
\`\`\``,
          desc: 'Binary Search Tree with insert, search, and in-order traversal. Average time: O(log n) per operation.',
        },
        javascript: {
          title: 'Binary Search Tree',
          code: `\`\`\`javascript
class TreeNode {
  constructor(val) {
    this.val = val;
    this.left = null;
    this.right = null;
  }
}

class BST {
  constructor() {
    this.root = null;
  }

  insert(val) {
    if (!this.root) { this.root = new TreeNode(val); return; }
    this._insert(this.root, val);
  }

  _insert(node, val) {
    if (val < node.val) {
      if (!node.left) node.left = new TreeNode(val);
      else this._insert(node.left, val);
    } else {
      if (!node.right) node.right = new TreeNode(val);
      else this._insert(node.right, val);
    }
  }

  search(val) {
    return this._search(this.root, val);
  }

  _search(node, val) {
    if (!node) return false;
    if (val === node.val) return true;
    return val < node.val
      ? this._search(node.left, val)
      : this._search(node.right, val);
  }

  inorder() {
    const result = [];
    this._inorder(this.root, result);
    return result;
  }

  _inorder(node, result) {
    if (node) {
      this._inorder(node.left, result);
      result.push(node.val);
      this._inorder(node.right, result);
    }
  }
}

// Usage:
const tree = new BST();
[5, 3, 7, 1, 4, 6, 8].forEach(v => tree.insert(v));
console.log(tree.inorder());   // [1, 3, 4, 5, 6, 7, 8]
console.log(tree.search(4));   // true
console.log(tree.search(9));   // false
\`\`\``,
          desc: 'Binary Search Tree with insert, search, and in-order traversal. Average time: O(log n) per operation.',
        },
      },
      // ─── STRING PROCESSING ───
      reverse_string: {
        python: {
          title: 'Reverse String',
          code: `\`\`\`python
def reverse_string(s):
    return s[::-1]

# Alternative (iterative):
def reverse_string_iter(s):
    chars = list(s)
    left, right = 0, len(chars) - 1
    while left < right:
        chars[left], chars[right] = chars[right], chars[left]
        left += 1
        right -= 1
    return ''.join(chars)

# Usage:
print(reverse_string("hello"))       # "olleh"
print(reverse_string_iter("world"))  # "dlrow"
\`\`\``,
          desc: 'Reverse a string — both Pythonic (slicing) and iterative (two-pointer) approaches.',
        },
        javascript: {
          title: 'Reverse String',
          code: `\`\`\`javascript
function reverseString(s) {
  return s.split('').reverse().join('');
}

// Alternative (iterative):
function reverseStringIter(s) {
  const chars = s.split('');
  let left = 0, right = chars.length - 1;
  while (left < right) {
    [chars[left], chars[right]] = [chars[right], chars[left]];
    left++;
    right--;
  }
  return chars.join('');
}

// Usage:
console.log(reverseString("hello"));       // "olleh"
console.log(reverseStringIter("world"));   // "dlrow"
\`\`\``,
          desc: 'Reverse a string — both built-in method and iterative (two-pointer) approaches.',
        },
      },
      reverse_words: {
        python: {
          title: 'Reverse Words in a Sentence',
          code: `\`\`\`python
def reverse_words(sentence):
    return ' '.join(sentence.split()[::-1])

# Alternative (explicit loop, preserves single spaces):
def reverse_words_loop(sentence):
    words = sentence.split()
    out = []
    for i in range(len(words) - 1, -1, -1):
        out.append(words[i])
    return ' '.join(out)

# Usage:
print(reverse_words("hello world from vai"))   # "vai from world hello"
print(reverse_words_loop("reverse these words")) # "words these reverse"
\`\`\``,
          desc: 'Reverse the order of words in a sentence (splits on whitespace, reverses the word list, rejoins with a single space). The individual words are left intact — only their order changes.',
        },
        javascript: {
          title: 'Reverse Words in a Sentence',
          code: `\`\`\`javascript
function reverseWords(sentence) {
  return sentence.split(' ').reverse().join(' ');
}

// Alternative — collapses runs of whitespace before reversing:
function reverseWordsTrim(sentence) {
  return sentence.trim().split(/\\s+/).reverse().join(' ');
}

// Usage:
console.log(reverseWords("hello world from vai"));     // "vai from world hello"
console.log(reverseWordsTrim("  reverse  these words ")); // "words these reverse"
\`\`\``,
          desc: 'Reverse the order of words in a sentence by splitting on spaces, reversing the resulting array, and joining back with a space. The words themselves stay intact — only their order changes.',
        },
      },
      palindrome_check: {
        python: {
          title: 'Palindrome Checker',
          code: `\`\`\`python
def is_palindrome(s):
    s = s.lower().replace(' ', '')
    return s == s[::-1]

# Usage:
print(is_palindrome("racecar"))    # True
print(is_palindrome("hello"))      # False
print(is_palindrome("A man a plan a canal Panama".replace(' ', '')))  # True
\`\`\``,
          desc: 'Check if a string is a palindrome — reads the same forwards and backwards.',
        },
        javascript: {
          title: 'Palindrome Checker',
          code: `\`\`\`javascript
function isPalindrome(s) {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned === cleaned.split('').reverse().join('');
}

// Usage:
console.log(isPalindrome("racecar"));   // true
console.log(isPalindrome("hello"));     // false
console.log(isPalindrome("A man a plan a canal Panama")); // true
\`\`\``,
          desc: 'Check if a string is a palindrome — reads the same forwards and backwards.',
        },
      },
      count_vowels: {
        python: {
          title: 'Count Vowels',
          code: `\`\`\`python
def count_vowels(s):
    vowels = set('aeiouAEIOU')
    return sum(1 for char in s if char in vowels)

# Usage:
print(count_vowels("hello"))        # 2
print(count_vowels("programming"))  # 3
\`\`\``,
          desc: 'Count the number of vowels (a, e, i, o, u) in a string.',
        },
        javascript: {
          title: 'Count Vowels',
          code: `\`\`\`javascript
function countVowels(s) {
  const matches = s.match(/[aeiou]/gi);
  return matches ? matches.length : 0;
}

// Usage:
console.log(countVowels("hello"));        // 2
console.log(countVowels("programming"));  // 3
\`\`\``,
          desc: 'Count the number of vowels (a, e, i, o, u) in a string.',
        },
      },
      anagram_check: {
        python: {
          title: 'Anagram Checker',
          code: `\`\`\`python
def is_anagram(s1, s2):
    return sorted(s1.lower().replace(' ', '')) == sorted(s2.lower().replace(' ', ''))

# Usage:
print(is_anagram("listen", "silent"))   # True
print(is_anagram("hello", "world"))     # False
print(is_anagram("Astronomer", "Moon starer"))  # True
\`\`\``,
          desc: 'Check if two strings are anagrams — contain the same characters in different order.',
        },
        javascript: {
          title: 'Anagram Checker',
          code: `\`\`\`javascript
function isAnagram(s1, s2) {
  const normalize = (s) => s.toLowerCase().replace(/\\s/g, '').split('').sort().join('');
  return normalize(s1) === normalize(s2);
}

// Usage:
console.log(isAnagram("listen", "silent"));  // true
console.log(isAnagram("hello", "world"));    // false
console.log(isAnagram("Astronomer", "Moon starer"));  // true
\`\`\``,
          desc: 'Check if two strings are anagrams — contain the same characters in different order.',
        },
      },
      // ─── MATH FUNCTIONS ───
      is_prime: {
        python: {
          title: 'Prime Number Check',
          code: `\`\`\`python
def is_prime(n):
    if n < 2:
        return False
    if n < 4:
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True

# Usage:
print(is_prime(17))   # True
print(is_prime(4))    # False
print(is_prime(97))   # True
\`\`\``,
          desc: 'Check if a number is prime using trial division up to √n with 6k±1 optimization. Time: O(√n).',
        },
        javascript: {
          title: 'Prime Number Check',
          code: `\`\`\`javascript
function isPrime(n) {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

// Usage:
console.log(isPrime(17));  // true
console.log(isPrime(4));   // false
console.log(isPrime(97));  // true
\`\`\``,
          desc: 'Check if a number is prime using trial division up to √n with 6k±1 optimization. Time: O(√n).',
        },
      },
      sieve: {
        python: {
          title: 'Sieve of Eratosthenes',
          code: `\`\`\`python
def sieve_of_eratosthenes(limit):
    is_prime = [True] * (limit + 1)
    is_prime[0] = is_prime[1] = False
    for i in range(2, int(limit**0.5) + 1):
        if is_prime[i]:
            for j in range(i*i, limit + 1, i):
                is_prime[j] = False
    return [i for i in range(limit + 1) if is_prime[i]]

# Usage:
print(sieve_of_eratosthenes(30))
# [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
\`\`\``,
          desc: 'Sieve of Eratosthenes — finds all prime numbers up to a limit. Time: O(n log log n).',
        },
        javascript: {
          title: 'Sieve of Eratosthenes',
          code: `\`\`\`javascript
function sieveOfEratosthenes(limit) {
  const isPrime = new Array(limit + 1).fill(true);
  isPrime[0] = isPrime[1] = false;
  for (let i = 2; i * i <= limit; i++) {
    if (isPrime[i]) {
      for (let j = i * i; j <= limit; j += i) {
        isPrime[j] = false;
      }
    }
  }
  return isPrime.reduce((primes, val, idx) => {
    if (val) primes.push(idx);
    return primes;
  }, []);
}

// Usage:
console.log(sieveOfEratosthenes(30));
// [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
\`\`\``,
          desc: 'Sieve of Eratosthenes — finds all prime numbers up to a limit. Time: O(n log log n).',
        },
      },
      lcm_function: {
        python: {
          title: 'LCM Function',
          code: `\`\`\`python
def gcd(a, b):
    while b:
        a, b = b, a % b
    return a

def lcm(a, b):
    return abs(a * b) // gcd(a, b)

# Usage:
print(lcm(12, 18))  # 36
print(lcm(4, 6))    # 12
\`\`\``,
          desc: 'Least Common Multiple calculated using GCD: LCM(a,b) = |a*b| / GCD(a,b).',
        },
        javascript: {
          title: 'LCM Function',
          code: `\`\`\`javascript
function gcd(a, b) {
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

function lcm(a, b) {
  return Math.abs(a * b) / gcd(a, b);
}

// Usage:
console.log(lcm(12, 18));  // 36
console.log(lcm(4, 6));    // 12
\`\`\``,
          desc: 'Least Common Multiple calculated using GCD: LCM(a,b) = |a*b| / GCD(a,b).',
        },
      },
      // ─── UTILITY FUNCTIONS ───
      flatten_array: {
        python: {
          title: 'Flatten Nested Array',
          code: `\`\`\`python
def flatten(arr):
    result = []
    for item in arr:
        if isinstance(item, list):
            result.extend(flatten(item))
        else:
            result.append(item)
    return result

# Usage:
print(flatten([1, [2, [3, 4], 5], [6, 7]]))
# [1, 2, 3, 4, 5, 6, 7]
\`\`\``,
          desc: 'Recursively flatten a nested array/list into a single flat list.',
        },
        javascript: {
          title: 'Flatten Nested Array',
          code: `\`\`\`javascript
function flatten(arr) {
  const result = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      result.push(...flatten(item));
    } else {
      result.push(item);
    }
  }
  return result;
}

// Usage:
console.log(flatten([1, [2, [3, 4], 5], [6, 7]]));
// [1, 2, 3, 4, 5, 6, 7]
\`\`\``,
          desc: 'Recursively flatten a nested array into a single flat array.',
        },
      },
      matrix_transpose: {
        python: {
          title: 'Matrix Transpose',
          code: `\`\`\`python
def transpose(matrix):
    rows = len(matrix)
    cols = len(matrix[0])
    return [[matrix[i][j] for i in range(rows)] for j in range(cols)]

# Usage:
m = [[1, 2, 3],
     [4, 5, 6]]
print(transpose(m))
# [[1, 4], [2, 5], [3, 6]]
\`\`\``,
          desc: 'Transpose a matrix — swap rows and columns. Element at [i][j] moves to [j][i].',
        },
        javascript: {
          title: 'Matrix Transpose',
          code: `\`\`\`javascript
function transpose(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result = [];
  for (let j = 0; j < cols; j++) {
    result[j] = [];
    for (let i = 0; i < rows; i++) {
      result[j][i] = matrix[i][j];
    }
  }
  return result;
}

// Usage:
const m = [[1, 2, 3],
           [4, 5, 6]];
console.log(transpose(m));
// [[1, 4], [2, 5], [3, 6]]
\`\`\``,
          desc: 'Transpose a matrix — swap rows and columns. Element at [i][j] moves to [j][i].',
        },
      },
      find_max: {
        python: {
          title: 'Find Maximum in Array',
          code: `\`\`\`python
def find_max(arr):
    if not arr:
        raise ValueError("Array is empty")
    maximum = arr[0]
    for num in arr[1:]:
        if num > maximum:
            maximum = num
    return maximum

# Usage:
print(find_max([3, 1, 4, 1, 5, 9, 2, 6]))  # 9
\`\`\``,
          desc: 'Find the maximum element in an array by iterating through all elements. Time: O(n).',
        },
        javascript: {
          title: 'Find Maximum in Array',
          code: `\`\`\`javascript
function findMax(arr) {
  if (arr.length === 0) throw new Error('Array is empty');
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

// Usage:
console.log(findMax([3, 1, 4, 1, 5, 9, 2, 6]));  // 9
\`\`\``,
          desc: 'Find the maximum element in an array by iterating through all elements. Time: O(n).',
        },
      },

      // ─── STRING MANIPULATION ───
      capitalize: {
        python: {
          title: 'Capitalize First Letter',
          code: `\`\`\`python
def capitalize(s):
    if not s:
        return s
    return s[0].upper() + s[1:]

# Usage:
print(capitalize("hello world"))  # "Hello world"
\`\`\``,
          desc: 'Uppercase only the first character and leave the rest of the string untouched. Time: O(n) for the slice.',
        },
        javascript: {
          title: 'Capitalize First Letter',
          code: `\`\`\`javascript
function capitalize(s) {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

// Usage:
console.log(capitalize('hello world'));  // "Hello world"
\`\`\``,
          desc: 'Uppercase only the first character and leave the rest of the string untouched. Time: O(n) for the slice.',
        },
      },
      title_case: {
        python: {
          title: 'Title Case (Capitalize Each Word)',
          code: `\`\`\`python
def title_case(s):
    return " ".join(w[:1].upper() + w[1:].lower() for w in s.split())

# Usage:
print(title_case("the quick brown fox"))  # "The Quick Brown Fox"
\`\`\``,
          desc: 'Split on whitespace, uppercase each word\'s first letter, lowercase the rest, and rejoin with single spaces.',
        },
        javascript: {
          title: 'Title Case (Capitalize Each Word)',
          code: `\`\`\`javascript
function titleCase(s) {
  return s
    .split(/\\s+/)
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// Usage:
console.log(titleCase('the quick brown fox'));  // "The Quick Brown Fox"
\`\`\``,
          desc: 'Split on whitespace, uppercase each word\'s first letter, lowercase the rest, and rejoin with single spaces.',
        },
      },
      slugify: {
        python: {
          title: 'Slugify a String',
          code: `\`\`\`python
import re

def slugify(s):
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9\\s-]", "", s)  # drop non-alphanumerics
    s = re.sub(r"[\\s_-]+", "-", s)        # collapse runs to single dash
    return s.strip("-")

# Usage:
print(slugify("Hello, World! 2025 — beta"))  # "hello-world-2025-beta"
\`\`\``,
          desc: 'Lowercase, strip non-alphanumerics, collapse whitespace/underscores into single dashes. Safe for URLs and file names.',
        },
        javascript: {
          title: 'Slugify a String',
          code: `\`\`\`javascript
function slugify(s) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\\s-]/g, '')
    .replace(/[\\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Usage:
console.log(slugify('Hello, World! 2025 — beta'));  // "hello-world-2025-beta"
\`\`\``,
          desc: 'Lowercase, strip non-alphanumerics, collapse whitespace/underscores into single dashes. Safe for URLs and file names.',
        },
      },
      to_camel_case: {
        python: {
          title: 'Convert to camelCase',
          code: `\`\`\`python
import re

def to_camel_case(s):
    parts = re.split(r"[\\s_-]+", s.strip())
    if not parts:
        return ""
    first = parts[0].lower()
    return first + "".join(w[:1].upper() + w[1:].lower() for w in parts[1:])

# Usage:
print(to_camel_case("hello world_example-string"))  # "helloWorldExampleString"
\`\`\``,
          desc: 'Split on whitespace, underscores, and dashes, lowercase the first word, and title-case the rest.',
        },
        javascript: {
          title: 'Convert to camelCase',
          code: `\`\`\`javascript
function toCamelCase(s) {
  const parts = s.trim().split(/[\\s_-]+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts[0].toLowerCase() + parts.slice(1)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

// Usage:
console.log(toCamelCase('hello world_example-string'));  // "helloWorldExampleString"
\`\`\``,
          desc: 'Split on whitespace, underscores, and dashes, lowercase the first word, and title-case the rest.',
        },
      },
      to_snake_case: {
        python: {
          title: 'Convert to snake_case',
          code: `\`\`\`python
import re

def to_snake_case(s):
    s = re.sub(r"([a-z0-9])([A-Z])", r"\\1_\\2", s)  # camel boundaries
    s = re.sub(r"[\\s-]+", "_", s.strip())
    return s.lower().strip("_")

# Usage:
print(to_snake_case("HelloWorld exampleString"))  # "hello_world_example_string"
\`\`\``,
          desc: 'Insert underscores at camelCase boundaries, normalise whitespace/dashes to underscores, then lowercase.',
        },
        javascript: {
          title: 'Convert to snake_case',
          code: `\`\`\`javascript
function toSnakeCase(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\\s-]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
}

// Usage:
console.log(toSnakeCase('HelloWorld exampleString'));  // "hello_world_example_string"
\`\`\``,
          desc: 'Insert underscores at camelCase boundaries, normalise whitespace/dashes to underscores, then lowercase.',
        },
      },
      to_kebab_case: {
        python: {
          title: 'Convert to kebab-case',
          code: `\`\`\`python
import re

def to_kebab_case(s):
    s = re.sub(r"([a-z0-9])([A-Z])", r"\\1-\\2", s)
    s = re.sub(r"[\\s_]+", "-", s.strip())
    return s.lower().strip("-")

# Usage:
print(to_kebab_case("HelloWorld example_string"))  # "hello-world-example-string"
\`\`\``,
          desc: 'Insert dashes at camelCase boundaries, normalise whitespace/underscores to dashes, then lowercase.',
        },
        javascript: {
          title: 'Convert to kebab-case',
          code: `\`\`\`javascript
function toKebabCase(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\\s_]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '');
}

// Usage:
console.log(toKebabCase('HelloWorld example_string'));  // "hello-world-example-string"
\`\`\``,
          desc: 'Insert dashes at camelCase boundaries, normalise whitespace/underscores to dashes, then lowercase.',
        },
      },
      word_count: {
        python: {
          title: 'Count Words in a String',
          code: `\`\`\`python
def word_count(s):
    if not s or not s.strip():
        return 0
    return len(s.split())

# Usage:
print(word_count("  hello   world  foo bar  "))  # 4
\`\`\``,
          desc: 'Use str.split() with no separator so consecutive whitespace collapses and leading/trailing is ignored.',
        },
        javascript: {
          title: 'Count Words in a String',
          code: `\`\`\`javascript
function wordCount(s) {
  if (!s || !s.trim()) return 0;
  return s.trim().split(/\\s+/).length;
}

// Usage:
console.log(wordCount('  hello   world  foo bar  '));  // 4
\`\`\``,
          desc: 'Trim then split on one-or-more whitespace so runs of spaces and tabs are treated as a single separator.',
        },
      },
      char_count: {
        python: {
          title: 'Count Characters in a String',
          code: `\`\`\`python
def char_count(s, include_spaces=True):
    if include_spaces:
        return len(s)
    return sum(1 for c in s if not c.isspace())

# Usage:
print(char_count("hello world"))              # 11
print(char_count("hello world", False))       # 10
\`\`\``,
          desc: 'Total length if spaces count; otherwise filter out whitespace characters. O(n).',
        },
        javascript: {
          title: 'Count Characters in a String',
          code: `\`\`\`javascript
function charCount(s, includeSpaces = true) {
  if (includeSpaces) return s.length;
  return [...s].filter(c => !/\\s/.test(c)).length;
}

// Usage:
console.log(charCount('hello world'));         // 11
console.log(charCount('hello world', false));  // 10
\`\`\``,
          desc: 'Total length if spaces count; otherwise filter out whitespace characters. O(n).',
        },
      },
      remove_whitespace: {
        python: {
          title: 'Remove / Collapse Whitespace',
          code: `\`\`\`python
import re

def remove_whitespace(s):
    return re.sub(r"\\s+", "", s)

def collapse_whitespace(s):
    return re.sub(r"\\s+", " ", s).strip()

# Usage:
print(remove_whitespace("  hello   world  "))    # "helloworld"
print(collapse_whitespace("  hello   world  "))  # "hello world"
\`\`\``,
          desc: 'Two variants: strip all whitespace, or collapse runs of whitespace down to a single space and trim.',
        },
        javascript: {
          title: 'Remove / Collapse Whitespace',
          code: `\`\`\`javascript
function removeWhitespace(s) {
  return s.replace(/\\s+/g, '');
}

function collapseWhitespace(s) {
  return s.replace(/\\s+/g, ' ').trim();
}

// Usage:
console.log(removeWhitespace('  hello   world  '));    // "helloworld"
console.log(collapseWhitespace('  hello   world  '));  // "hello world"
\`\`\``,
          desc: 'Two variants: strip all whitespace, or collapse runs of whitespace down to a single space and trim.',
        },
      },
      truncate_string: {
        python: {
          title: 'Truncate String with Ellipsis',
          code: `\`\`\`python
def truncate(s, max_len, suffix="…"):
    if len(s) <= max_len:
        return s
    # reserve room for the suffix
    cut = max(0, max_len - len(suffix))
    return s[:cut].rstrip() + suffix

# Usage:
print(truncate("the quick brown fox", 10))  # "the quick…"
\`\`\``,
          desc: 'Cut the string to max_len characters reserving room for the ellipsis suffix. Trims trailing whitespace before appending.',
        },
        javascript: {
          title: 'Truncate String with Ellipsis',
          code: `\`\`\`javascript
function truncate(s, maxLen, suffix = '…') {
  if (s.length <= maxLen) return s;
  const cut = Math.max(0, maxLen - suffix.length);
  return s.slice(0, cut).trimEnd() + suffix;
}

// Usage:
console.log(truncate('the quick brown fox', 10));  // "the quick…"
\`\`\``,
          desc: 'Cut the string to maxLen characters reserving room for the ellipsis suffix. Trims trailing whitespace before appending.',
        },
      },

      // ─── ARRAY OPERATIONS ───
      chunk_array: {
        python: {
          title: 'Chunk Array Into Fixed-Size Groups',
          code: `\`\`\`python
def chunk(arr, size):
    if size <= 0:
        raise ValueError("size must be positive")
    return [arr[i:i + size] for i in range(0, len(arr), size)]

# Usage:
print(chunk([1, 2, 3, 4, 5, 6, 7], 3))  # [[1, 2, 3], [4, 5, 6], [7]]
\`\`\``,
          desc: 'Slice the array into groups of the given size; the last group may be smaller. Time: O(n).',
        },
        javascript: {
          title: 'Chunk Array Into Fixed-Size Groups',
          code: `\`\`\`javascript
function chunk(arr, size) {
  if (size <= 0) throw new Error('size must be positive');
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

// Usage:
console.log(chunk([1, 2, 3, 4, 5, 6, 7], 3));  // [[1, 2, 3], [4, 5, 6], [7]]
\`\`\``,
          desc: 'Slice the array into groups of the given size; the last group may be smaller. Time: O(n).',
        },
      },
      unique_array: {
        python: {
          title: 'Unique Array (Preserve Order)',
          code: `\`\`\`python
def unique(arr):
    seen = set()
    out = []
    for x in arr:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out

# Usage:
print(unique([1, 2, 2, 3, 1, 4, 3]))  # [1, 2, 3, 4]
\`\`\``,
          desc: 'Keep first occurrence of each element using a set for O(1) lookup. Preserves insertion order. Time: O(n).',
        },
        javascript: {
          title: 'Unique Array (Preserve Order)',
          code: `\`\`\`javascript
function unique(arr) {
  return [...new Set(arr)];
}

// Usage:
console.log(unique([1, 2, 2, 3, 1, 4, 3]));  // [1, 2, 3, 4]
\`\`\``,
          desc: 'Using the Set constructor preserves insertion order and deduplicates in O(n).',
        },
      },
      group_by: {
        python: {
          title: 'Group By Key Function',
          code: `\`\`\`python
from collections import defaultdict

def group_by(arr, key):
    out = defaultdict(list)
    for item in arr:
        out[key(item)].append(item)
    return dict(out)

# Usage:
people = [{"name": "Ada", "role": "eng"}, {"name": "Bo", "role": "pm"}, {"name": "Cy", "role": "eng"}]
print(group_by(people, lambda p: p["role"]))
# {'eng': [{'name': 'Ada', ...}, {'name': 'Cy', ...}], 'pm': [{'name': 'Bo', ...}]}
\`\`\``,
          desc: 'Bucket items by the result of the key function. Time: O(n).',
        },
        javascript: {
          title: 'Group By Key Function',
          code: `\`\`\`javascript
function groupBy(arr, key) {
  const out = {};
  for (const item of arr) {
    const k = typeof key === 'function' ? key(item) : item[key];
    (out[k] ||= []).push(item);
  }
  return out;
}

// Usage:
const people = [{ name: 'Ada', role: 'eng' }, { name: 'Bo', role: 'pm' }, { name: 'Cy', role: 'eng' }];
console.log(groupBy(people, 'role'));
// { eng: [{name:'Ada',...}, {name:'Cy',...}], pm: [{name:'Bo',...}] }
\`\`\``,
          desc: 'Accepts either a key function or a property name. Bucket items by key in O(n).',
        },
      },
      partition_array: {
        python: {
          title: 'Partition Array by Predicate',
          code: `\`\`\`python
def partition(arr, predicate):
    truthy, falsy = [], []
    for x in arr:
        (truthy if predicate(x) else falsy).append(x)
    return truthy, falsy

# Usage:
evens, odds = partition([1, 2, 3, 4, 5], lambda n: n % 2 == 0)
print(evens, odds)  # [2, 4] [1, 3, 5]
\`\`\``,
          desc: 'Single pass splits elements into two lists based on the predicate. Time: O(n).',
        },
        javascript: {
          title: 'Partition Array by Predicate',
          code: `\`\`\`javascript
function partition(arr, predicate) {
  const truthy = [], falsy = [];
  for (const x of arr) {
    (predicate(x) ? truthy : falsy).push(x);
  }
  return [truthy, falsy];
}

// Usage:
const [evens, odds] = partition([1, 2, 3, 4, 5], n => n % 2 === 0);
console.log(evens, odds);  // [2, 4] [1, 3, 5]
\`\`\``,
          desc: 'Single pass splits elements into two arrays based on the predicate. Time: O(n).',
        },
      },
      zip_arrays: {
        python: {
          title: 'Zip Arrays',
          code: `\`\`\`python
def zip_arrays(*arrays):
    return list(zip(*arrays))

# Usage:
print(zip_arrays([1, 2, 3], ["a", "b", "c"]))  # [(1, 'a'), (2, 'b'), (3, 'c')]
\`\`\``,
          desc: 'Thin wrapper around the built-in zip that produces tuples pairwise. Stops at the shortest input.',
        },
        javascript: {
          title: 'Zip Arrays',
          code: `\`\`\`javascript
function zip(...arrays) {
  const len = Math.min(...arrays.map(a => a.length));
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(arrays.map(a => a[i]));
  }
  return out;
}

// Usage:
console.log(zip([1, 2, 3], ['a', 'b', 'c']));  // [[1,'a'],[2,'b'],[3,'c']]
\`\`\``,
          desc: 'Pair elements by index across any number of input arrays. Stops at the shortest input.',
        },
      },
      range_array: {
        python: {
          title: 'Generate a Range of Numbers',
          code: `\`\`\`python
def number_range(start, stop=None, step=1):
    if stop is None:
        start, stop = 0, start
    if step == 0:
        raise ValueError("step must be non-zero")
    return list(range(start, stop, step))

# Usage:
print(number_range(5))           # [0, 1, 2, 3, 4]
print(number_range(2, 10, 2))    # [2, 4, 6, 8]
\`\`\``,
          desc: 'Python has range() built in; this mirrors its semantics but materialises a list and validates step.',
        },
        javascript: {
          title: 'Generate a Range of Numbers',
          code: `\`\`\`javascript
function range(start, stop, step = 1) {
  if (stop === undefined) { stop = start; start = 0; }
  if (step === 0) throw new Error('step must be non-zero');
  const out = [];
  if (step > 0) {
    for (let i = start; i < stop; i += step) out.push(i);
  } else {
    for (let i = start; i > stop; i += step) out.push(i);
  }
  return out;
}

// Usage:
console.log(range(5));         // [0, 1, 2, 3, 4]
console.log(range(2, 10, 2));  // [2, 4, 6, 8]
\`\`\``,
          desc: 'Python-style range with positive or negative step. Empty array when start/stop/step are inconsistent.',
        },
      },
      flatten_deep: {
        python: {
          title: 'Flatten Nested Array (Deep)',
          code: `\`\`\`python
def flatten_deep(arr):
    out = []
    for x in arr:
        if isinstance(x, list):
            out.extend(flatten_deep(x))
        else:
            out.append(x)
    return out

# Usage:
print(flatten_deep([1, [2, [3, [4, [5]]]], 6]))  # [1, 2, 3, 4, 5, 6]
\`\`\``,
          desc: 'Recursively walk into nested lists and collect scalar values. Unlike flatten() at depth=1, this handles any depth.',
        },
        javascript: {
          title: 'Flatten Nested Array (Deep)',
          code: `\`\`\`javascript
function flattenDeep(arr) {
  return arr.flat(Infinity);
}

// Iterative fallback for environments without Array.prototype.flat:
function flattenDeepIterative(arr) {
  const out = [];
  const stack = [...arr];
  while (stack.length) {
    const x = stack.shift();
    Array.isArray(x) ? stack.unshift(...x) : out.push(x);
  }
  return out;
}

// Usage:
console.log(flattenDeep([1, [2, [3, [4, [5]]]], 6]));  // [1, 2, 3, 4, 5, 6]
\`\`\``,
          desc: 'Array.prototype.flat(Infinity) handles the deep case natively on modern runtimes; the iterative version is safe on older targets.',
        },
      },
      intersection: {
        python: {
          title: 'Array Intersection',
          code: `\`\`\`python
def intersection(*arrays):
    if not arrays:
        return []
    result = set(arrays[0])
    for a in arrays[1:]:
        result &= set(a)
    # preserve original order of the first input
    return [x for x in arrays[0] if x in result]

# Usage:
print(intersection([1, 2, 3, 4], [2, 3, 5], [3, 2, 9]))  # [2, 3]
\`\`\``,
          desc: 'Use set intersection (&) across all inputs, then project back onto the first array for stable order. Time: O(Σ|arrays|).',
        },
        javascript: {
          title: 'Array Intersection',
          code: `\`\`\`javascript
function intersection(...arrays) {
  if (arrays.length === 0) return [];
  const sets = arrays.slice(1).map(a => new Set(a));
  return [...new Set(arrays[0])].filter(x => sets.every(s => s.has(x)));
}

// Usage:
console.log(intersection([1, 2, 3, 4], [2, 3, 5], [3, 2, 9]));  // [2, 3]
\`\`\``,
          desc: 'Dedup the first array, then keep only elements present in every other array using Set.has for O(1) lookup.',
        },
      },
      union_arrays: {
        python: {
          title: 'Array Union (Preserve Order)',
          code: `\`\`\`python
def union(*arrays):
    seen = set()
    out = []
    for a in arrays:
        for x in a:
            if x not in seen:
                seen.add(x)
                out.append(x)
    return out

# Usage:
print(union([1, 2, 3], [3, 4, 5], [5, 6]))  # [1, 2, 3, 4, 5, 6]
\`\`\``,
          desc: 'Concatenate inputs and deduplicate while preserving first-seen order. Time: O(Σ|arrays|).',
        },
        javascript: {
          title: 'Array Union (Preserve Order)',
          code: `\`\`\`javascript
function union(...arrays) {
  return [...new Set(arrays.flat())];
}

// Usage:
console.log(union([1, 2, 3], [3, 4, 5], [5, 6]));  // [1, 2, 3, 4, 5, 6]
\`\`\``,
          desc: 'Flatten one level and feed into a Set to dedup while keeping first-seen order.',
        },
      },
      rotate_array: {
        python: {
          title: 'Rotate Array by k Positions',
          code: `\`\`\`python
def rotate(arr, k):
    n = len(arr)
    if n == 0:
        return arr[:]
    k %= n  # handles negatives and k > n
    return arr[-k:] + arr[:-k]

# Usage:
print(rotate([1, 2, 3, 4, 5], 2))   # [4, 5, 1, 2, 3]  (right rotation)
print(rotate([1, 2, 3, 4, 5], -1))  # [2, 3, 4, 5, 1]  (left rotation)
\`\`\``,
          desc: 'Right-rotate by k (negative k rotates left). Modulo handles rotations larger than the array. Time: O(n).',
        },
        javascript: {
          title: 'Rotate Array by k Positions',
          code: `\`\`\`javascript
function rotate(arr, k) {
  const n = arr.length;
  if (n === 0) return [...arr];
  const r = ((k % n) + n) % n;  // normalise negatives
  return arr.slice(n - r).concat(arr.slice(0, n - r));
}

// Usage:
console.log(rotate([1, 2, 3, 4, 5], 2));   // [4, 5, 1, 2, 3]
console.log(rotate([1, 2, 3, 4, 5], -1));  // [2, 3, 4, 5, 1]
\`\`\``,
          desc: 'Right-rotate by k (negative rotates left). Normalises k with a positive modulus so rotations larger than the array work. Time: O(n).',
        },
      },

      // ─── EXTENDED SORTING & SEARCHING ───
      quicksort: {
        python: {
          title: 'Quicksort',
          code: `\`\`\`python
def quicksort(arr):
    if len(arr) <= 1:
        return arr[:]
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    mid = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + mid + quicksort(right)

# Usage:
print(quicksort([3, 1, 4, 1, 5, 9, 2, 6]))  # [1, 1, 2, 3, 4, 5, 6, 9]
\`\`\``,
          desc: 'Divide-and-conquer with a middle-element pivot. Average O(n log n), worst O(n²) when the pivot is consistently the extreme.',
        },
        javascript: {
          title: 'Quicksort',
          code: `\`\`\`javascript
function quicksort(arr) {
  if (arr.length <= 1) return [...arr];
  const pivot = arr[Math.floor(arr.length / 2)];
  const left = arr.filter(x => x < pivot);
  const mid = arr.filter(x => x === pivot);
  const right = arr.filter(x => x > pivot);
  return [...quicksort(left), ...mid, ...quicksort(right)];
}

// Usage:
console.log(quicksort([3, 1, 4, 1, 5, 9, 2, 6]));  // [1, 1, 2, 3, 4, 5, 6, 9]
\`\`\``,
          desc: 'Divide-and-conquer with a middle-element pivot. Average O(n log n), worst O(n²).',
        },
      },
      heapsort: {
        python: {
          title: 'Heapsort',
          code: `\`\`\`python
import heapq

def heapsort(arr):
    h = arr[:]
    heapq.heapify(h)
    return [heapq.heappop(h) for _ in range(len(h))]

# Usage:
print(heapsort([3, 1, 4, 1, 5, 9, 2, 6]))  # [1, 1, 2, 3, 4, 5, 6, 9]
\`\`\``,
          desc: 'Heapify the array then pop the minimum n times. O(n log n), in-place variant exists but this uses heapq for clarity.',
        },
        javascript: {
          title: 'Heapsort',
          code: `\`\`\`javascript
function heapsort(arr) {
  const a = [...arr];
  const n = a.length;
  const siftDown = (start, end) => {
    let root = start;
    while (2 * root + 1 <= end) {
      let child = 2 * root + 1;
      if (child + 1 <= end && a[child] < a[child + 1]) child++;
      if (a[root] < a[child]) { [a[root], a[child]] = [a[child], a[root]]; root = child; }
      else return;
    }
  };
  for (let i = Math.floor(n / 2) - 1; i >= 0; i--) siftDown(i, n - 1);
  for (let end = n - 1; end > 0; end--) {
    [a[0], a[end]] = [a[end], a[0]];
    siftDown(0, end - 1);
  }
  return a;
}

// Usage:
console.log(heapsort([3, 1, 4, 1, 5, 9, 2, 6]));  // [1, 1, 2, 3, 4, 5, 6, 9]
\`\`\``,
          desc: 'In-place max-heap construction then repeated extract-max. O(n log n) time, O(1) auxiliary space.',
        },
      },
      counting_sort: {
        python: {
          title: 'Counting Sort (Non-Negative Integers)',
          code: `\`\`\`python
def counting_sort(arr):
    if not arr:
        return []
    m = max(arr)
    counts = [0] * (m + 1)
    for x in arr:
        counts[x] += 1
    out = []
    for value, c in enumerate(counts):
        out.extend([value] * c)
    return out

# Usage:
print(counting_sort([3, 1, 4, 1, 5, 9, 2, 6]))  # [1, 1, 2, 3, 4, 5, 6, 9]
\`\`\``,
          desc: 'Non-comparison sort for bounded non-negative integers. O(n + k) where k is the max value. Not stable without an extra pass.',
        },
        javascript: {
          title: 'Counting Sort (Non-Negative Integers)',
          code: `\`\`\`javascript
function countingSort(arr) {
  if (arr.length === 0) return [];
  const m = Math.max(...arr);
  const counts = new Array(m + 1).fill(0);
  for (const x of arr) counts[x]++;
  const out = [];
  counts.forEach((c, v) => { for (let i = 0; i < c; i++) out.push(v); });
  return out;
}

// Usage:
console.log(countingSort([3, 1, 4, 1, 5, 9, 2, 6]));  // [1, 1, 2, 3, 4, 5, 6, 9]
\`\`\``,
          desc: 'Non-comparison sort for bounded non-negative integers. O(n + k) where k is the max value.',
        },
      },
      radix_sort: {
        python: {
          title: 'Radix Sort (LSD, Non-Negative Integers)',
          code: `\`\`\`python
def radix_sort(arr):
    if not arr:
        return []
    a = arr[:]
    exp = 1
    m = max(a)
    while m // exp > 0:
        buckets = [[] for _ in range(10)]
        for x in a:
            buckets[(x // exp) % 10].append(x)
        a = [x for bucket in buckets for x in bucket]
        exp *= 10
    return a

# Usage:
print(radix_sort([170, 45, 75, 90, 802, 24, 2, 66]))  # [2, 24, 45, 66, 75, 90, 170, 802]
\`\`\``,
          desc: 'Least-significant-digit radix sort using base-10 buckets. O(d · (n + 10)) where d is the digit count of the max value.',
        },
        javascript: {
          title: 'Radix Sort (LSD, Non-Negative Integers)',
          code: `\`\`\`javascript
function radixSort(arr) {
  if (arr.length === 0) return [];
  let a = [...arr];
  const m = Math.max(...a);
  let exp = 1;
  while (Math.floor(m / exp) > 0) {
    const buckets = Array.from({ length: 10 }, () => []);
    for (const x of a) buckets[Math.floor(x / exp) % 10].push(x);
    a = buckets.flat();
    exp *= 10;
  }
  return a;
}

// Usage:
console.log(radixSort([170, 45, 75, 90, 802, 24, 2, 66]));  // [2, 24, 45, 66, 75, 90, 170, 802]
\`\`\``,
          desc: 'LSD radix sort via base-10 buckets. O(d · (n + 10)) where d is the digit count of the max value.',
        },
      },
      linear_search: {
        python: {
          title: 'Linear Search',
          code: `\`\`\`python
def linear_search(arr, target):
    for i, x in enumerate(arr):
        if x == target:
            return i
    return -1

# Usage:
print(linear_search([5, 2, 8, 1, 9], 8))  # 2
print(linear_search([5, 2, 8, 1, 9], 7))  # -1
\`\`\``,
          desc: 'Sequential scan returning the first index equal to target, or -1 if absent. Time: O(n).',
        },
        javascript: {
          title: 'Linear Search',
          code: `\`\`\`javascript
function linearSearch(arr, target) {
  for (let i = 0; i < arr.length; i++) if (arr[i] === target) return i;
  return -1;
}

// Usage:
console.log(linearSearch([5, 2, 8, 1, 9], 8));  // 2
console.log(linearSearch([5, 2, 8, 1, 9], 7));  // -1
\`\`\``,
          desc: 'Sequential scan returning the first index equal to target, or -1 if absent. Time: O(n).',
        },
      },
      interpolation_search: {
        python: {
          title: 'Interpolation Search (Sorted, Uniform)',
          code: `\`\`\`python
def interpolation_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi and arr[lo] <= target <= arr[hi]:
        if arr[lo] == arr[hi]:
            return lo if arr[lo] == target else -1
        pos = lo + ((target - arr[lo]) * (hi - lo)) // (arr[hi] - arr[lo])
        if arr[pos] == target:
            return pos
        if arr[pos] < target:
            lo = pos + 1
        else:
            hi = pos - 1
    return -1

# Usage:
print(interpolation_search([1, 3, 5, 7, 9, 11, 13, 15], 9))  # 4
\`\`\``,
          desc: 'Like binary search but picks the probe position using linear interpolation. O(log log n) on uniformly distributed inputs, O(n) worst case.',
        },
        javascript: {
          title: 'Interpolation Search (Sorted, Uniform)',
          code: `\`\`\`javascript
function interpolationSearch(arr, target) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi && target >= arr[lo] && target <= arr[hi]) {
    if (arr[lo] === arr[hi]) return arr[lo] === target ? lo : -1;
    const pos = lo + Math.floor(((target - arr[lo]) * (hi - lo)) / (arr[hi] - arr[lo]));
    if (arr[pos] === target) return pos;
    if (arr[pos] < target) lo = pos + 1; else hi = pos - 1;
  }
  return -1;
}

// Usage:
console.log(interpolationSearch([1, 3, 5, 7, 9, 11, 13, 15], 9));  // 4
\`\`\``,
          desc: 'Binary search with interpolated probe. O(log log n) average on uniform data, O(n) worst case.',
        },
      },
      find_min: {
        python: {
          title: 'Find Minimum in Array',
          code: `\`\`\`python
def find_min(arr):
    if not arr:
        raise ValueError("Array is empty")
    minimum = arr[0]
    for x in arr[1:]:
        if x < minimum:
            minimum = x
    return minimum

# Usage:
print(find_min([3, 1, 4, 1, 5, 9, 2, 6]))  # 1
\`\`\``,
          desc: 'Single pass tracking the smallest value seen. Time: O(n).',
        },
        javascript: {
          title: 'Find Minimum in Array',
          code: `\`\`\`javascript
function findMin(arr) {
  if (arr.length === 0) throw new Error('Array is empty');
  let min = arr[0];
  for (let i = 1; i < arr.length; i++) if (arr[i] < min) min = arr[i];
  return min;
}

// Usage:
console.log(findMin([3, 1, 4, 1, 5, 9, 2, 6]));  // 1
\`\`\``,
          desc: 'Single pass tracking the smallest value seen. Time: O(n).',
        },
      },
      sum_array: {
        python: {
          title: 'Sum of Array',
          code: `\`\`\`python
def sum_array(arr):
    total = 0
    for x in arr:
        total += x
    return total

# Usage:
print(sum_array([1, 2, 3, 4, 5]))  # 15
\`\`\``,
          desc: 'Sum all elements in a single linear pass. Built-in sum() does the same. Time: O(n).',
        },
        javascript: {
          title: 'Sum of Array',
          code: `\`\`\`javascript
function sumArray(arr) {
  return arr.reduce((acc, x) => acc + x, 0);
}

// Usage:
console.log(sumArray([1, 2, 3, 4, 5]));  // 15
\`\`\``,
          desc: 'reduce starting from 0 accumulates the total in O(n).',
        },
      },
      count_occurrences: {
        python: {
          title: 'Count Occurrences in Array',
          code: `\`\`\`python
def count_occurrences(arr, target):
    return sum(1 for x in arr if x == target)

# Usage:
print(count_occurrences([1, 2, 3, 2, 4, 2, 5], 2))  # 3
\`\`\``,
          desc: 'Linear scan counting equal elements. collections.Counter gives the whole frequency map if needed. Time: O(n).',
        },
        javascript: {
          title: 'Count Occurrences in Array',
          code: `\`\`\`javascript
function countOccurrences(arr, target) {
  return arr.reduce((acc, x) => acc + (x === target ? 1 : 0), 0);
}

// Usage:
console.log(countOccurrences([1, 2, 3, 2, 4, 2, 5], 2));  // 3
\`\`\``,
          desc: 'reduce-based count of matching elements. Time: O(n).',
        },
      },

      // ─── DYNAMIC PROGRAMMING ───
      coin_change: {
        python: {
          title: 'Coin Change (Min Coins to Make Amount)',
          code: `\`\`\`python
def coin_change(coins, amount):
    INF = amount + 1
    dp = [0] + [INF] * amount
    for a in range(1, amount + 1):
        for c in coins:
            if c <= a:
                dp[a] = min(dp[a], dp[a - c] + 1)
    return dp[amount] if dp[amount] != INF else -1

# Usage:
print(coin_change([1, 2, 5], 11))  # 3 (5+5+1)
print(coin_change([2], 3))         # -1
\`\`\``,
          desc: 'Bottom-up DP where dp[a] = min coins to make amount a. Returns -1 when unreachable. Time: O(amount · |coins|).',
        },
        javascript: {
          title: 'Coin Change (Min Coins to Make Amount)',
          code: `\`\`\`javascript
function coinChange(coins, amount) {
  const INF = amount + 1;
  const dp = new Array(amount + 1).fill(INF);
  dp[0] = 0;
  for (let a = 1; a <= amount; a++) {
    for (const c of coins) {
      if (c <= a) dp[a] = Math.min(dp[a], dp[a - c] + 1);
    }
  }
  return dp[amount] === INF ? -1 : dp[amount];
}

// Usage:
console.log(coinChange([1, 2, 5], 11));  // 3
console.log(coinChange([2], 3));         // -1
\`\`\``,
          desc: 'Bottom-up DP. dp[a] = min coins to form amount a. Time: O(amount · |coins|), space O(amount).',
        },
      },
      edit_distance: {
        python: {
          title: 'Edit Distance (Levenshtein)',
          code: `\`\`\`python
def edit_distance(a, b):
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1]
            else:
                dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[m][n]

# Usage:
print(edit_distance("kitten", "sitting"))  # 3
\`\`\``,
          desc: 'Standard 2-D DP for minimum insert/delete/replace operations. Time & space: O(m · n).',
        },
        javascript: {
          title: 'Edit Distance (Levenshtein)',
          code: `\`\`\`javascript
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Usage:
console.log(editDistance('kitten', 'sitting'));  // 3
\`\`\``,
          desc: 'Standard 2-D DP. Time and space O(m · n). Space can be compressed to O(min(m, n)) with two rolling rows.',
        },
      },
      lcs: {
        python: {
          title: 'Longest Common Subsequence',
          code: `\`\`\`python
def lcs(a, b):
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    # reconstruct
    i, j, out = m, n, []
    while i > 0 and j > 0:
        if a[i - 1] == b[j - 1]:
            out.append(a[i - 1]); i -= 1; j -= 1
        elif dp[i - 1][j] >= dp[i][j - 1]:
            i -= 1
        else:
            j -= 1
    return "".join(reversed(out))

# Usage:
print(lcs("ABCBDAB", "BDCAB"))  # "BCAB" or another length-4 LCS
\`\`\``,
          desc: 'Classic 2-D DP plus backtracking to reconstruct the subsequence. Time & space: O(m · n).',
        },
        javascript: {
          title: 'Longest Common Subsequence',
          code: `\`\`\`javascript
function lcs(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  let i = m, j = n, out = '';
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { out = a[i - 1] + out; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return out;
}

// Usage:
console.log(lcs('ABCBDAB', 'BDCAB'));  // e.g. "BCAB"
\`\`\``,
          desc: '2-D DP with backtracking reconstruction. Time & space: O(m · n).',
        },
      },
      kadane_max_subarray: {
        python: {
          title: 'Maximum Subarray Sum (Kadane)',
          code: `\`\`\`python
def max_subarray(arr):
    if not arr:
        return 0
    best = current = arr[0]
    for x in arr[1:]:
        current = max(x, current + x)
        best = max(best, current)
    return best

# Usage:
print(max_subarray([-2, 1, -3, 4, -1, 2, 1, -5, 4]))  # 6  (subarray [4,-1,2,1])
\`\`\``,
          desc: 'Kadane\'s algorithm: at each index decide whether to extend the current subarray or start a new one. Time: O(n), space: O(1).',
        },
        javascript: {
          title: 'Maximum Subarray Sum (Kadane)',
          code: `\`\`\`javascript
function maxSubarray(arr) {
  if (arr.length === 0) return 0;
  let best = arr[0], current = arr[0];
  for (let i = 1; i < arr.length; i++) {
    current = Math.max(arr[i], current + arr[i]);
    best = Math.max(best, current);
  }
  return best;
}

// Usage:
console.log(maxSubarray([-2, 1, -3, 4, -1, 2, 1, -5, 4]));  // 6
\`\`\``,
          desc: 'Kadane\'s algorithm. Track the best subarray ending at each index. Time: O(n), space: O(1).',
        },
      },
      knapsack: {
        python: {
          title: '0/1 Knapsack',
          code: `\`\`\`python
def knapsack(weights, values, capacity):
    n = len(weights)
    dp = [[0] * (capacity + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for w in range(capacity + 1):
            dp[i][w] = dp[i - 1][w]
            if weights[i - 1] <= w:
                dp[i][w] = max(dp[i][w], dp[i - 1][w - weights[i - 1]] + values[i - 1])
    return dp[n][capacity]

# Usage:
print(knapsack([2, 3, 4, 5], [3, 4, 5, 6], 5))  # 7
\`\`\``,
          desc: 'Classic 0/1 knapsack DP. Each item used at most once. Time & space: O(n · capacity).',
        },
        javascript: {
          title: '0/1 Knapsack',
          code: `\`\`\`javascript
function knapsack(weights, values, capacity) {
  const n = weights.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(capacity + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (weights[i - 1] <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - weights[i - 1]] + values[i - 1]);
      }
    }
  }
  return dp[n][capacity];
}

// Usage:
console.log(knapsack([2, 3, 4, 5], [3, 4, 5, 6], 5));  // 7
\`\`\``,
          desc: 'Classic 0/1 knapsack DP. Time & space O(n · capacity). Space can drop to O(capacity) with a 1-D table.',
        },
      },
      longest_increasing_subseq: {
        python: {
          title: 'Longest Increasing Subsequence',
          code: `\`\`\`python
from bisect import bisect_left

def lis_length(arr):
    tails = []
    for x in arr:
        i = bisect_left(tails, x)
        if i == len(tails):
            tails.append(x)
        else:
            tails[i] = x
    return len(tails)

# Usage:
print(lis_length([10, 9, 2, 5, 3, 7, 101, 18]))  # 4  (e.g. [2,3,7,101])
\`\`\``,
          desc: 'Patience-sort technique using bisect_left on a running array of smallest tail values. Time: O(n log n).',
        },
        javascript: {
          title: 'Longest Increasing Subsequence',
          code: `\`\`\`javascript
function lisLength(arr) {
  const tails = [];
  for (const x of arr) {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < x) lo = mid + 1; else hi = mid;
    }
    tails[lo] = x;
  }
  return tails.length;
}

// Usage:
console.log(lisLength([10, 9, 2, 5, 3, 7, 101, 18]));  // 4
\`\`\``,
          desc: 'Patience-sort with manual binary search. Time: O(n log n), space: O(n).',
        },
      },
      climb_stairs: {
        python: {
          title: 'Climbing Stairs',
          code: `\`\`\`python
def climb_stairs(n):
    if n <= 2:
        return n
    a, b = 1, 2
    for _ in range(3, n + 1):
        a, b = b, a + b
    return b

# Usage:
print(climb_stairs(5))  # 8
\`\`\``,
          desc: 'Fibonacci-style recurrence: ways(n) = ways(n-1) + ways(n-2). Time: O(n), space: O(1).',
        },
        javascript: {
          title: 'Climbing Stairs',
          code: `\`\`\`javascript
function climbStairs(n) {
  if (n <= 2) return n;
  let a = 1, b = 2;
  for (let i = 3; i <= n; i++) [a, b] = [b, a + b];
  return b;
}

// Usage:
console.log(climbStairs(5));  // 8
\`\`\``,
          desc: 'Rolling Fibonacci recurrence. Time: O(n), space: O(1).',
        },
      },
      house_robber: {
        python: {
          title: 'House Robber',
          code: `\`\`\`python
def rob(nums):
    prev, curr = 0, 0
    for x in nums:
        prev, curr = curr, max(curr, prev + x)
    return curr

# Usage:
print(rob([2, 7, 9, 3, 1]))  # 12
\`\`\``,
          desc: 'DP over rolling two variables: at each house choose max(skip-then-curr, rob-then-prev+curr). Time: O(n), space: O(1).',
        },
        javascript: {
          title: 'House Robber',
          code: `\`\`\`javascript
function rob(nums) {
  let prev = 0, curr = 0;
  for (const x of nums) [prev, curr] = [curr, Math.max(curr, prev + x)];
  return curr;
}

// Usage:
console.log(rob([2, 7, 9, 3, 1]));  // 12
\`\`\``,
          desc: 'Rolling DP with two state variables. Time: O(n), space: O(1).',
        },
      },
      unique_paths: {
        python: {
          title: 'Unique Paths in an m × n Grid',
          code: `\`\`\`python
def unique_paths(m, n):
    dp = [[1] * n for _ in range(m)]
    for i in range(1, m):
        for j in range(1, n):
            dp[i][j] = dp[i - 1][j] + dp[i][j - 1]
    return dp[m - 1][n - 1]

# Usage:
print(unique_paths(3, 7))  # 28
\`\`\``,
          desc: 'Each cell is the sum of the cell above and left (only right/down moves allowed). Time & space: O(m · n).',
        },
        javascript: {
          title: 'Unique Paths in an m × n Grid',
          code: `\`\`\`javascript
function uniquePaths(m, n) {
  const dp = Array.from({ length: m }, () => new Array(n).fill(1));
  for (let i = 1; i < m; i++) {
    for (let j = 1; j < n; j++) dp[i][j] = dp[i - 1][j] + dp[i][j - 1];
  }
  return dp[m - 1][n - 1];
}

// Usage:
console.log(uniquePaths(3, 7));  // 28
\`\`\``,
          desc: 'Grid DP: paths(i,j) = paths(i-1,j) + paths(i,j-1). Time & space O(m · n).',
        },
      },
      fibonacci_iterative: {
        python: {
          title: 'Fibonacci (Iterative, O(1) Space)',
          code: `\`\`\`python
def fibonacci(n):
    if n < 0:
        raise ValueError("n must be non-negative")
    if n < 2:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b

# Usage:
print(fibonacci(10))  # 55
\`\`\``,
          desc: 'Iterative rolling-pair approach. Avoids the exponential blow-up of naïve recursion. Time: O(n), space: O(1).',
        },
        javascript: {
          title: 'Fibonacci (Iterative, O(1) Space)',
          code: `\`\`\`javascript
function fibonacci(n) {
  if (n < 0) throw new Error('n must be non-negative');
  if (n < 2) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) [a, b] = [b, a + b];
  return b;
}

// Usage:
console.log(fibonacci(10));  // 55
\`\`\``,
          desc: 'Iterative rolling-pair approach. Time: O(n), space: O(1).',
        },
      },
      fibonacci_memo: {
        python: {
          title: 'Fibonacci (Memoised Recursion)',
          code: `\`\`\`python
from functools import lru_cache

@lru_cache(maxsize=None)
def fibonacci(n):
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# Usage:
print(fibonacci(50))  # 12586269025
\`\`\``,
          desc: 'lru_cache memoises subproblems so each fib(k) is computed once. Time: O(n), space: O(n).',
        },
        javascript: {
          title: 'Fibonacci (Memoised Recursion)',
          code: `\`\`\`javascript
function makeFibonacci() {
  const cache = new Map([[0, 0], [1, 1]]);
  const fib = (n) => {
    if (cache.has(n)) return cache.get(n);
    const v = fib(n - 1) + fib(n - 2);
    cache.set(n, v);
    return v;
  };
  return fib;
}

// Usage:
const fibonacci = makeFibonacci();
console.log(fibonacci(50));  // 12586269025
\`\`\``,
          desc: 'Closure-backed cache memoises subproblems. Time: O(n), space: O(n).',
        },
      },

      // ─── GRAPH ALGORITHMS ───
      bfs_graph: {
        python: {
          title: 'Breadth-First Search',
          code: `\`\`\`python
from collections import deque

def bfs(graph, start):
    visited = {start}
    order = []
    queue = deque([start])
    while queue:
        node = queue.popleft()
        order.append(node)
        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return order

# Usage:
graph = {"A": ["B", "C"], "B": ["D"], "C": ["D", "E"], "D": [], "E": []}
print(bfs(graph, "A"))  # ['A', 'B', 'C', 'D', 'E']
\`\`\``,
          desc: 'Level-order traversal using a FIFO queue. Time: O(V + E), space: O(V).',
        },
        javascript: {
          title: 'Breadth-First Search',
          code: `\`\`\`javascript
function bfs(graph, start) {
  const visited = new Set([start]);
  const order = [];
  const queue = [start];
  while (queue.length) {
    const node = queue.shift();
    order.push(node);
    for (const n of graph[node] ?? []) {
      if (!visited.has(n)) { visited.add(n); queue.push(n); }
    }
  }
  return order;
}

// Usage:
const graph = { A: ['B', 'C'], B: ['D'], C: ['D', 'E'], D: [], E: [] };
console.log(bfs(graph, 'A'));  // ['A', 'B', 'C', 'D', 'E']
\`\`\``,
          desc: 'Level-order traversal using a FIFO queue. Time: O(V + E), space: O(V).',
        },
      },
      dfs_graph: {
        python: {
          title: 'Depth-First Search',
          code: `\`\`\`python
def dfs(graph, start):
    visited = set()
    order = []
    def helper(node):
        if node in visited:
            return
        visited.add(node)
        order.append(node)
        for neighbor in graph.get(node, []):
            helper(neighbor)
    helper(start)
    return order

# Usage:
graph = {"A": ["B", "C"], "B": ["D"], "C": ["D", "E"], "D": [], "E": []}
print(dfs(graph, "A"))  # ['A', 'B', 'D', 'C', 'E']
\`\`\``,
          desc: 'Recursive DFS marking visited nodes to avoid revisiting. Time: O(V + E), space: O(V) for the recursion stack.',
        },
        javascript: {
          title: 'Depth-First Search',
          code: `\`\`\`javascript
function dfs(graph, start) {
  const visited = new Set();
  const order = [];
  const helper = (node) => {
    if (visited.has(node)) return;
    visited.add(node);
    order.push(node);
    for (const n of graph[node] ?? []) helper(n);
  };
  helper(start);
  return order;
}

// Usage:
const graph = { A: ['B', 'C'], B: ['D'], C: ['D', 'E'], D: [], E: [] };
console.log(dfs(graph, 'A'));  // ['A', 'B', 'D', 'C', 'E']
\`\`\``,
          desc: 'Recursive DFS with a visited set. Time: O(V + E), space: O(V).',
        },
      },
      dijkstra: {
        python: {
          title: 'Dijkstra\'s Shortest Paths',
          code: `\`\`\`python
import heapq

def dijkstra(graph, start):
    """graph: {node: [(neighbor, weight), ...]}. Non-negative weights only."""
    distances = {node: float("inf") for node in graph}
    distances[start] = 0
    pq = [(0, start)]
    while pq:
        dist, node = heapq.heappop(pq)
        if dist > distances[node]:
            continue
        for neighbor, weight in graph.get(node, []):
            new_dist = dist + weight
            if new_dist < distances[neighbor]:
                distances[neighbor] = new_dist
                heapq.heappush(pq, (new_dist, neighbor))
    return distances

# Usage:
graph = {"A": [("B", 1), ("C", 4)], "B": [("C", 2), ("D", 5)], "C": [("D", 1)], "D": []}
print(dijkstra(graph, "A"))  # {'A': 0, 'B': 1, 'C': 3, 'D': 4}
\`\`\``,
          desc: 'Priority-queue-based shortest path for non-negative weights. Time: O((V + E) log V) with a binary heap.',
        },
        javascript: {
          title: 'Dijkstra\'s Shortest Paths',
          code: `\`\`\`javascript
function dijkstra(graph, start) {
  const distances = Object.fromEntries(Object.keys(graph).map(n => [n, Infinity]));
  distances[start] = 0;
  const pq = [[0, start]];  // min-heap via repeated sort (use a real heap for production)
  while (pq.length) {
    pq.sort((a, b) => a[0] - b[0]);
    const [dist, node] = pq.shift();
    if (dist > distances[node]) continue;
    for (const [neighbor, weight] of graph[node] ?? []) {
      const nd = dist + weight;
      if (nd < distances[neighbor]) { distances[neighbor] = nd; pq.push([nd, neighbor]); }
    }
  }
  return distances;
}

// Usage:
const graph = { A: [['B', 1], ['C', 4]], B: [['C', 2], ['D', 5]], C: [['D', 1]], D: [] };
console.log(dijkstra(graph, 'A'));  // { A: 0, B: 1, C: 3, D: 4 }
\`\`\``,
          desc: 'Non-negative weights only. Swap the sort-based queue for a proper binary heap in production; complexity becomes O((V+E) log V).',
        },
      },
      topological_sort: {
        python: {
          title: 'Topological Sort (Kahn\'s Algorithm)',
          code: `\`\`\`python
from collections import deque

def topological_sort(graph):
    """graph: {node: [neighbors]} for a directed acyclic graph."""
    indegree = {n: 0 for n in graph}
    for n in graph:
        for m in graph[n]:
            indegree[m] = indegree.get(m, 0) + 1
    queue = deque([n for n, d in indegree.items() if d == 0])
    order = []
    while queue:
        n = queue.popleft()
        order.append(n)
        for m in graph.get(n, []):
            indegree[m] -= 1
            if indegree[m] == 0:
                queue.append(m)
    return order if len(order) == len(indegree) else None  # None when a cycle exists

# Usage:
graph = {"A": ["C"], "B": ["C", "D"], "C": ["E"], "D": ["F"], "E": ["F"], "F": []}
print(topological_sort(graph))  # e.g. ['A', 'B', 'C', 'D', 'E', 'F']
\`\`\``,
          desc: 'Kahn\'s in-degree algorithm. Emits vertices with zero remaining in-edges. Returns None if the graph has a cycle. Time: O(V + E).',
        },
        javascript: {
          title: 'Topological Sort (Kahn\'s Algorithm)',
          code: `\`\`\`javascript
function topologicalSort(graph) {
  const indegree = {};
  for (const n of Object.keys(graph)) indegree[n] = 0;
  for (const n of Object.keys(graph)) for (const m of graph[n]) indegree[m] = (indegree[m] ?? 0) + 1;
  const queue = Object.keys(indegree).filter(n => indegree[n] === 0);
  const order = [];
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    for (const m of graph[n] ?? []) if (--indegree[m] === 0) queue.push(m);
  }
  return order.length === Object.keys(indegree).length ? order : null;
}

// Usage:
const graph = { A: ['C'], B: ['C', 'D'], C: ['E'], D: ['F'], E: ['F'], F: [] };
console.log(topologicalSort(graph));
\`\`\``,
          desc: 'Kahn\'s algorithm. Returns null when the graph has a cycle. Time: O(V + E).',
        },
      },
      detect_cycle_graph: {
        python: {
          title: 'Detect Cycle in Undirected Graph',
          code: `\`\`\`python
def has_cycle(graph):
    visited = set()
    def dfs(node, parent):
        visited.add(node)
        for n in graph.get(node, []):
            if n not in visited:
                if dfs(n, node):
                    return True
            elif n != parent:
                return True
        return False
    for node in graph:
        if node not in visited and dfs(node, None):
            return True
    return False

# Usage:
print(has_cycle({"A": ["B"], "B": ["A", "C"], "C": ["B", "D"], "D": ["C"]}))  # False
print(has_cycle({"A": ["B"], "B": ["A", "C"], "C": ["B", "A"]}))              # True
\`\`\``,
          desc: 'DFS tracking the parent. A back-edge to any visited non-parent vertex proves a cycle. Time: O(V + E).',
        },
        javascript: {
          title: 'Detect Cycle in Undirected Graph',
          code: `\`\`\`javascript
function hasCycle(graph) {
  const visited = new Set();
  const dfs = (node, parent) => {
    visited.add(node);
    for (const n of graph[node] ?? []) {
      if (!visited.has(n)) {
        if (dfs(n, node)) return true;
      } else if (n !== parent) {
        return true;
      }
    }
    return false;
  };
  for (const node of Object.keys(graph)) {
    if (!visited.has(node) && dfs(node, null)) return true;
  }
  return false;
}

// Usage:
console.log(hasCycle({ A: ['B'], B: ['A', 'C'], C: ['B', 'A'] }));  // true
\`\`\``,
          desc: 'DFS parent-tracking cycle detection. Time: O(V + E).',
        },
      },
      union_find: {
        python: {
          title: 'Union-Find (Disjoint Set Union)',
          code: `\`\`\`python
class UnionFind:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]  # path compression
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1
        return True

# Usage:
uf = UnionFind(5)
uf.union(0, 1); uf.union(1, 2)
print(uf.find(0) == uf.find(2))  # True
print(uf.find(0) == uf.find(3))  # False
\`\`\``,
          desc: 'Path compression + union-by-rank gives near-constant amortised time per op (O(α(n))).',
        },
        javascript: {
          title: 'Union-Find (Disjoint Set Union)',
          code: `\`\`\`javascript
class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
    return true;
  }
}

// Usage:
const uf = new UnionFind(5);
uf.union(0, 1); uf.union(1, 2);
console.log(uf.find(0) === uf.find(2));  // true
\`\`\``,
          desc: 'Path compression + union by rank. Near-constant amortised time per op.',
        },
      },

      // ─── TREE ALGORITHMS ───
      bst_search: {
        python: {
          title: 'BST Search',
          code: `\`\`\`python
class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val = val; self.left = left; self.right = right

def bst_search(root, target):
    node = root
    while node:
        if target == node.val:
            return node
        node = node.left if target < node.val else node.right
    return None

# Usage:
root = TreeNode(5, TreeNode(3, TreeNode(1), TreeNode(4)), TreeNode(8, TreeNode(7), TreeNode(9)))
print(bst_search(root, 7).val if bst_search(root, 7) else None)  # 7
\`\`\``,
          desc: 'Iterative descent following the BST ordering. Time: O(h) where h is the tree height (log n for balanced trees).',
        },
        javascript: {
          title: 'BST Search',
          code: `\`\`\`javascript
class TreeNode {
  constructor(val, left = null, right = null) { this.val = val; this.left = left; this.right = right; }
}

function bstSearch(root, target) {
  let node = root;
  while (node) {
    if (target === node.val) return node;
    node = target < node.val ? node.left : node.right;
  }
  return null;
}

// Usage:
const root = new TreeNode(5, new TreeNode(3, new TreeNode(1), new TreeNode(4)), new TreeNode(8, new TreeNode(7), new TreeNode(9)));
console.log(bstSearch(root, 7)?.val);  // 7
\`\`\``,
          desc: 'Iterative descent following the BST invariant. Time: O(h).',
        },
      },
      tree_inorder: {
        python: {
          title: 'In-Order Tree Traversal',
          code: `\`\`\`python
def inorder(root):
    result, stack, node = [], [], root
    while node or stack:
        while node:
            stack.append(node)
            node = node.left
        node = stack.pop()
        result.append(node.val)
        node = node.right
    return result
\`\`\``,
          desc: 'Iterative left → root → right traversal using an explicit stack. Time: O(n), space: O(h).',
        },
        javascript: {
          title: 'In-Order Tree Traversal',
          code: `\`\`\`javascript
function inorder(root) {
  const result = [], stack = [];
  let node = root;
  while (node || stack.length) {
    while (node) { stack.push(node); node = node.left; }
    node = stack.pop();
    result.push(node.val);
    node = node.right;
  }
  return result;
}
\`\`\``,
          desc: 'Iterative left → root → right traversal using an explicit stack. Time: O(n), space: O(h).',
        },
      },
      tree_preorder: {
        python: {
          title: 'Pre-Order Tree Traversal',
          code: `\`\`\`python
def preorder(root):
    if not root:
        return []
    result, stack = [], [root]
    while stack:
        node = stack.pop()
        result.append(node.val)
        if node.right:
            stack.append(node.right)
        if node.left:
            stack.append(node.left)
    return result
\`\`\``,
          desc: 'Iterative root → left → right traversal with an explicit stack (push right first so left is processed next). Time: O(n).',
        },
        javascript: {
          title: 'Pre-Order Tree Traversal',
          code: `\`\`\`javascript
function preorder(root) {
  if (!root) return [];
  const result = [], stack = [root];
  while (stack.length) {
    const node = stack.pop();
    result.push(node.val);
    if (node.right) stack.push(node.right);
    if (node.left) stack.push(node.left);
  }
  return result;
}
\`\`\``,
          desc: 'Iterative root → left → right. Push right first so left is processed next. Time: O(n).',
        },
      },
      tree_postorder: {
        python: {
          title: 'Post-Order Tree Traversal',
          code: `\`\`\`python
def postorder(root):
    if not root:
        return []
    result, stack = [], [root]
    while stack:
        node = stack.pop()
        result.append(node.val)
        if node.left:
            stack.append(node.left)
        if node.right:
            stack.append(node.right)
    return result[::-1]  # reverse gives true post-order
\`\`\``,
          desc: 'Trick: do a modified pre-order (root, right, left) and reverse the result. Time: O(n).',
        },
        javascript: {
          title: 'Post-Order Tree Traversal',
          code: `\`\`\`javascript
function postorder(root) {
  if (!root) return [];
  const result = [], stack = [root];
  while (stack.length) {
    const node = stack.pop();
    result.push(node.val);
    if (node.left) stack.push(node.left);
    if (node.right) stack.push(node.right);
  }
  return result.reverse();
}
\`\`\``,
          desc: 'Modified pre-order (root, right, left) then reversed gives post-order. Time: O(n).',
        },
      },
      tree_levelorder: {
        python: {
          title: 'Level-Order Tree Traversal',
          code: `\`\`\`python
from collections import deque

def level_order(root):
    if not root:
        return []
    result, queue = [], deque([root])
    while queue:
        level = []
        for _ in range(len(queue)):
            node = queue.popleft()
            level.append(node.val)
            if node.left:
                queue.append(node.left)
            if node.right:
                queue.append(node.right)
        result.append(level)
    return result
\`\`\``,
          desc: 'BFS over the tree, grouping values by level. Time: O(n), space: O(w) where w is max width.',
        },
        javascript: {
          title: 'Level-Order Tree Traversal',
          code: `\`\`\`javascript
function levelOrder(root) {
  if (!root) return [];
  const result = [], queue = [root];
  while (queue.length) {
    const level = [], size = queue.length;
    for (let i = 0; i < size; i++) {
      const node = queue.shift();
      level.push(node.val);
      if (node.left) queue.push(node.left);
      if (node.right) queue.push(node.right);
    }
    result.push(level);
  }
  return result;
}
\`\`\``,
          desc: 'BFS over the tree, grouping by level. Time: O(n).',
        },
      },
      tree_height: {
        python: {
          title: 'Height of a Binary Tree',
          code: `\`\`\`python
def tree_height(root):
    if root is None:
        return 0
    return 1 + max(tree_height(root.left), tree_height(root.right))
\`\`\``,
          desc: 'Recursive definition: height of an empty tree is 0, otherwise 1 + max height of subtrees. Time: O(n).',
        },
        javascript: {
          title: 'Height of a Binary Tree',
          code: `\`\`\`javascript
function treeHeight(root) {
  if (!root) return 0;
  return 1 + Math.max(treeHeight(root.left), treeHeight(root.right));
}
\`\`\``,
          desc: 'Recursive definition. Time: O(n).',
        },
      },
      tree_invert: {
        python: {
          title: 'Invert (Mirror) a Binary Tree',
          code: `\`\`\`python
def invert_tree(root):
    if root is None:
        return None
    root.left, root.right = invert_tree(root.right), invert_tree(root.left)
    return root
\`\`\``,
          desc: 'Recursively swap left and right children at every node. Time: O(n), space: O(h) for the recursion stack.',
        },
        javascript: {
          title: 'Invert (Mirror) a Binary Tree',
          code: `\`\`\`javascript
function invertTree(root) {
  if (!root) return null;
  [root.left, root.right] = [invertTree(root.right), invertTree(root.left)];
  return root;
}
\`\`\``,
          desc: 'Recursively swap left/right children at every node. Time: O(n).',
        },
      },
      tree_path_sum: {
        python: {
          title: 'Root-to-Leaf Path Sum Exists',
          code: `\`\`\`python
def has_path_sum(root, target):
    if root is None:
        return False
    if root.left is None and root.right is None:
        return target == root.val
    remaining = target - root.val
    return has_path_sum(root.left, remaining) or has_path_sum(root.right, remaining)
\`\`\``,
          desc: 'DFS subtracting each node\'s value along the path. Returns True iff some root-to-leaf path sums to the target. Time: O(n).',
        },
        javascript: {
          title: 'Root-to-Leaf Path Sum Exists',
          code: `\`\`\`javascript
function hasPathSum(root, target) {
  if (!root) return false;
  if (!root.left && !root.right) return target === root.val;
  const remaining = target - root.val;
  return hasPathSum(root.left, remaining) || hasPathSum(root.right, remaining);
}
\`\`\``,
          desc: 'DFS subtracting each node\'s value down the path. Time: O(n).',
        },
      },

      // ─── DATA STRUCTURES ───
      lru_cache: {
        python: {
          title: 'LRU Cache (O(1) get / put)',
          code: `\`\`\`python
from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.cache = OrderedDict()

    def get(self, key):
        if key not in self.cache:
            return -1
        self.cache.move_to_end(key)
        return self.cache[key]

    def put(self, key, value):
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)

# Usage:
cache = LRUCache(2)
cache.put(1, "a"); cache.put(2, "b")
print(cache.get(1))  # "a" — 1 is now most-recent
cache.put(3, "c")    # evicts 2
print(cache.get(2))  # -1
\`\`\``,
          desc: 'OrderedDict gives O(1) get/put with easy most-recently-used ordering. Evicts the least-recently-used key when at capacity.',
        },
        javascript: {
          title: 'LRU Cache (O(1) get / put)',
          code: `\`\`\`javascript
class LRUCache {
  constructor(capacity) { this.capacity = capacity; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return -1;
    const v = this.map.get(key);
    this.map.delete(key); this.map.set(key, v);
    return v;
  }
  put(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value);
  }
}

// Usage:
const cache = new LRUCache(2);
cache.put(1, 'a'); cache.put(2, 'b');
console.log(cache.get(1));  // 'a'
cache.put(3, 'c');          // evicts 2
console.log(cache.get(2));  // -1
\`\`\``,
          desc: 'JS Map preserves insertion order; delete+re-set is the cheapest way to bump a key to most-recently-used.',
        },
      },
      trie: {
        python: {
          title: 'Trie (Prefix Tree)',
          code: `\`\`\`python
class Trie:
    def __init__(self):
        self.children = {}
        self.end = False

    def insert(self, word):
        node = self
        for ch in word:
            node = node.children.setdefault(ch, Trie())
        node.end = True

    def search(self, word):
        node = self._walk(word)
        return node is not None and node.end

    def starts_with(self, prefix):
        return self._walk(prefix) is not None

    def _walk(self, s):
        node = self
        for ch in s:
            if ch not in node.children:
                return None
            node = node.children[ch]
        return node

# Usage:
t = Trie()
t.insert("apple"); t.insert("app")
print(t.search("app"))        # True
print(t.search("apples"))     # False
print(t.starts_with("appl"))  # True
\`\`\``,
          desc: 'Dict-of-children trie. O(m) insert/search/starts_with where m is the word length.',
        },
        javascript: {
          title: 'Trie (Prefix Tree)',
          code: `\`\`\`javascript
class Trie {
  constructor() { this.children = new Map(); this.end = false; }
  insert(word) {
    let node = this;
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, new Trie());
      node = node.children.get(ch);
    }
    node.end = true;
  }
  _walk(s) {
    let node = this;
    for (const ch of s) {
      if (!node.children.has(ch)) return null;
      node = node.children.get(ch);
    }
    return node;
  }
  search(word) { const n = this._walk(word); return !!n && n.end; }
  startsWith(prefix) { return this._walk(prefix) !== null; }
}

// Usage:
const t = new Trie();
t.insert('apple'); t.insert('app');
console.log(t.search('app'));        // true
console.log(t.search('apples'));     // false
console.log(t.startsWith('appl'));   // true
\`\`\``,
          desc: 'Map-of-children trie. O(m) insert/search/startsWith.',
        },
      },
      heap: {
        python: {
          title: 'Min-Heap (Priority Queue)',
          code: `\`\`\`python
import heapq

class MinHeap:
    def __init__(self):
        self.h = []

    def push(self, x):
        heapq.heappush(self.h, x)

    def pop(self):
        return heapq.heappop(self.h)

    def peek(self):
        return self.h[0] if self.h else None

    def __len__(self):
        return len(self.h)

# Usage:
h = MinHeap()
for x in [5, 2, 8, 1, 9]: h.push(x)
print(h.pop(), h.pop())  # 1 2
\`\`\``,
          desc: 'Thin wrapper around heapq for clarity. Push/pop are O(log n); peek is O(1).',
        },
        javascript: {
          title: 'Min-Heap (Priority Queue)',
          code: `\`\`\`javascript
class MinHeap {
  constructor() { this.h = []; }
  push(x) {
    this.h.push(x);
    let i = this.h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p] <= this.h[i]) break;
      [this.h[p], this.h[i]] = [this.h[i], this.h[p]];
      i = p;
    }
  }
  pop() {
    if (this.h.length === 0) return undefined;
    const top = this.h[0];
    const last = this.h.pop();
    if (this.h.length) {
      this.h[0] = last;
      let i = 0, n = this.h.length;
      while (true) {
        let l = 2 * i + 1, r = l + 1, s = i;
        if (l < n && this.h[l] < this.h[s]) s = l;
        if (r < n && this.h[r] < this.h[s]) s = r;
        if (s === i) break;
        [this.h[s], this.h[i]] = [this.h[i], this.h[s]]; i = s;
      }
    }
    return top;
  }
  peek() { return this.h[0]; }
  get size() { return this.h.length; }
}

// Usage:
const h = new MinHeap();
for (const x of [5, 2, 8, 1, 9]) h.push(x);
console.log(h.pop(), h.pop());  // 1 2
\`\`\``,
          desc: 'Array-backed binary min-heap with sift-up on push and sift-down on pop. Both O(log n), peek O(1).',
        },
      },
      linked_list: {
        python: {
          title: 'Singly Linked List',
          code: `\`\`\`python
class ListNode:
    def __init__(self, val, next=None):
        self.val = val; self.next = next

class LinkedList:
    def __init__(self):
        self.head = None

    def push_front(self, val):
        self.head = ListNode(val, self.head)

    def append(self, val):
        if self.head is None:
            self.head = ListNode(val)
            return
        node = self.head
        while node.next:
            node = node.next
        node.next = ListNode(val)

    def remove(self, val):
        dummy = ListNode(0, self.head)
        prev = dummy
        while prev.next:
            if prev.next.val == val:
                prev.next = prev.next.next
                self.head = dummy.next
                return True
            prev = prev.next
        return False

    def to_list(self):
        out, node = [], self.head
        while node:
            out.append(node.val); node = node.next
        return out
\`\`\``,
          desc: 'Standard singly linked list with push_front, append, remove. push_front is O(1); append and remove are O(n).',
        },
        javascript: {
          title: 'Singly Linked List',
          code: `\`\`\`javascript
class ListNode { constructor(val, next = null) { this.val = val; this.next = next; } }

class LinkedList {
  constructor() { this.head = null; }
  pushFront(val) { this.head = new ListNode(val, this.head); }
  append(val) {
    if (!this.head) { this.head = new ListNode(val); return; }
    let node = this.head;
    while (node.next) node = node.next;
    node.next = new ListNode(val);
  }
  remove(val) {
    const dummy = new ListNode(0, this.head);
    let prev = dummy;
    while (prev.next) {
      if (prev.next.val === val) {
        prev.next = prev.next.next;
        this.head = dummy.next;
        return true;
      }
      prev = prev.next;
    }
    return false;
  }
  toArray() {
    const out = []; let node = this.head;
    while (node) { out.push(node.val); node = node.next; }
    return out;
  }
}
\`\`\``,
          desc: 'Standard singly linked list. pushFront O(1); append and remove O(n). Dummy node keeps removal logic clean.',
        },
      },
      doubly_linked_list: {
        python: {
          title: 'Doubly Linked List',
          code: `\`\`\`python
class DListNode:
    def __init__(self, val, prev=None, next=None):
        self.val = val; self.prev = prev; self.next = next

class DoublyLinkedList:
    def __init__(self):
        self.head = self.tail = None
        self.size = 0

    def push_front(self, val):
        node = DListNode(val, None, self.head)
        if self.head:
            self.head.prev = node
        else:
            self.tail = node
        self.head = node
        self.size += 1

    def push_back(self, val):
        node = DListNode(val, self.tail, None)
        if self.tail:
            self.tail.next = node
        else:
            self.head = node
        self.tail = node
        self.size += 1

    def pop_front(self):
        if not self.head:
            return None
        val = self.head.val
        self.head = self.head.next
        if self.head:
            self.head.prev = None
        else:
            self.tail = None
        self.size -= 1
        return val

    def pop_back(self):
        if not self.tail:
            return None
        val = self.tail.val
        self.tail = self.tail.prev
        if self.tail:
            self.tail.next = None
        else:
            self.head = None
        self.size -= 1
        return val
\`\`\``,
          desc: 'Doubly linked list with O(1) push/pop at both ends. Useful as the backing store for deques and LRU caches.',
        },
        javascript: {
          title: 'Doubly Linked List',
          code: `\`\`\`javascript
class DListNode {
  constructor(val, prev = null, next = null) { this.val = val; this.prev = prev; this.next = next; }
}

class DoublyLinkedList {
  constructor() { this.head = null; this.tail = null; this.size = 0; }
  pushFront(val) {
    const node = new DListNode(val, null, this.head);
    if (this.head) this.head.prev = node; else this.tail = node;
    this.head = node; this.size++;
  }
  pushBack(val) {
    const node = new DListNode(val, this.tail, null);
    if (this.tail) this.tail.next = node; else this.head = node;
    this.tail = node; this.size++;
  }
  popFront() {
    if (!this.head) return null;
    const val = this.head.val;
    this.head = this.head.next;
    if (this.head) this.head.prev = null; else this.tail = null;
    this.size--; return val;
  }
  popBack() {
    if (!this.tail) return null;
    const val = this.tail.val;
    this.tail = this.tail.prev;
    if (this.tail) this.tail.next = null; else this.head = null;
    this.size--; return val;
  }
}
\`\`\``,
          desc: 'Doubly linked list with O(1) push/pop at both ends.',
        },
      },
      deque: {
        python: {
          title: 'Double-Ended Queue (Deque)',
          code: `\`\`\`python
from collections import deque

# collections.deque is O(1) append/appendleft/pop/popleft
q = deque([1, 2, 3])
q.append(4)          # [1, 2, 3, 4]
q.appendleft(0)      # [0, 1, 2, 3, 4]
q.pop()              # 4
q.popleft()          # 0
print(list(q))        # [1, 2, 3]
\`\`\``,
          desc: 'collections.deque gives O(1) appends and pops at both ends, backed by a doubly linked list of fixed-size blocks.',
        },
        javascript: {
          title: 'Double-Ended Queue (Deque)',
          code: `\`\`\`javascript
class Deque {
  constructor() { this.head = this.tail = null; this.size = 0; }
  pushBack(val)  { const n = { val, prev: this.tail, next: null }; if (this.tail) this.tail.next = n; else this.head = n; this.tail = n; this.size++; }
  pushFront(val) { const n = { val, prev: null, next: this.head }; if (this.head) this.head.prev = n; else this.tail = n; this.head = n; this.size++; }
  popBack()  { if (!this.tail) return undefined; const v = this.tail.val; this.tail = this.tail.prev; if (this.tail) this.tail.next = null; else this.head = null; this.size--; return v; }
  popFront() { if (!this.head) return undefined; const v = this.head.val; this.head = this.head.next; if (this.head) this.head.prev = null; else this.tail = null; this.size--; return v; }
  peekFront() { return this.head?.val; }
  peekBack()  { return this.tail?.val; }
}

// Usage:
const q = new Deque();
q.pushBack(1); q.pushBack(2); q.pushFront(0);
console.log(q.popFront(), q.popBack(), q.popBack());  // 0 2 1
\`\`\``,
          desc: 'Doubly-linked-list-backed deque. All push/pop ops are O(1).',
        },
      },

      // ─── STRING ALGORITHMS ───
      kmp_search: {
        python: {
          title: 'KMP Substring Search',
          code: `\`\`\`python
def kmp_search(text, pattern):
    if not pattern:
        return 0
    # Build LPS (longest proper prefix which is also suffix)
    lps = [0] * len(pattern)
    length = 0
    i = 1
    while i < len(pattern):
        if pattern[i] == pattern[length]:
            length += 1; lps[i] = length; i += 1
        elif length:
            length = lps[length - 1]
        else:
            lps[i] = 0; i += 1
    # Search
    i = j = 0
    while i < len(text):
        if text[i] == pattern[j]:
            i += 1; j += 1
            if j == len(pattern):
                return i - j
        elif j:
            j = lps[j - 1]
        else:
            i += 1
    return -1

# Usage:
print(kmp_search("abxabcabcaby", "abcaby"))  # 6
\`\`\``,
          desc: 'Knuth-Morris-Pratt substring search. Preprocesses the pattern in O(m) then scans the text in O(n) for O(n + m) total.',
        },
        javascript: {
          title: 'KMP Substring Search',
          code: `\`\`\`javascript
function kmpSearch(text, pattern) {
  if (!pattern) return 0;
  const lps = new Array(pattern.length).fill(0);
  let length = 0, i = 1;
  while (i < pattern.length) {
    if (pattern[i] === pattern[length]) { lps[i++] = ++length; }
    else if (length) { length = lps[length - 1]; }
    else { lps[i++] = 0; }
  }
  let ti = 0, pi = 0;
  while (ti < text.length) {
    if (text[ti] === pattern[pi]) {
      ti++; pi++;
      if (pi === pattern.length) return ti - pi;
    } else if (pi) { pi = lps[pi - 1]; }
    else { ti++; }
  }
  return -1;
}
\`\`\``,
          desc: 'KMP substring search in O(n + m). LPS table skips redundant comparisons after a mismatch.',
        },
      },
      rabin_karp: {
        python: {
          title: 'Rabin-Karp Substring Search',
          code: `\`\`\`python
def rabin_karp(text, pattern, base=256, mod=10**9 + 7):
    n, m = len(text), len(pattern)
    if m == 0:
        return 0
    if m > n:
        return -1
    h = pow(base, m - 1, mod)
    pat_hash = text_hash = 0
    for i in range(m):
        pat_hash = (pat_hash * base + ord(pattern[i])) % mod
        text_hash = (text_hash * base + ord(text[i])) % mod
    for i in range(n - m + 1):
        if pat_hash == text_hash and text[i:i + m] == pattern:
            return i
        if i < n - m:
            text_hash = ((text_hash - ord(text[i]) * h) * base + ord(text[i + m])) % mod
    return -1
\`\`\``,
          desc: 'Rolling-hash substring search. Average O(n + m); worst case O(n * m) on hash collisions. Good when searching many patterns in the same text.',
        },
        javascript: {
          title: 'Rabin-Karp Substring Search',
          code: `\`\`\`javascript
function rabinKarp(text, pattern, base = 256, mod = 1_000_000_007) {
  const n = text.length, m = pattern.length;
  if (m === 0) return 0;
  if (m > n) return -1;
  let h = 1;
  for (let i = 0; i < m - 1; i++) h = (h * base) % mod;
  let patHash = 0, textHash = 0;
  for (let i = 0; i < m; i++) {
    patHash = (patHash * base + pattern.charCodeAt(i)) % mod;
    textHash = (textHash * base + text.charCodeAt(i)) % mod;
  }
  for (let i = 0; i <= n - m; i++) {
    if (patHash === textHash && text.slice(i, i + m) === pattern) return i;
    if (i < n - m) {
      textHash = ((textHash - text.charCodeAt(i) * h) * base + text.charCodeAt(i + m)) % mod;
      if (textHash < 0) textHash += mod;
    }
  }
  return -1;
}
\`\`\``,
          desc: 'Rolling-hash substring search. Average O(n + m); good for multi-pattern search on the same text.',
        },
      },
      z_algorithm: {
        python: {
          title: 'Z-Algorithm (Pattern Matching)',
          code: `\`\`\`python
def z_function(s):
    n = len(s)
    z = [0] * n
    l = r = 0
    for i in range(1, n):
        if i < r:
            z[i] = min(r - i, z[i - l])
        while i + z[i] < n and s[z[i]] == s[i + z[i]]:
            z[i] += 1
        if i + z[i] > r:
            l, r = i, i + z[i]
    return z

def z_search(text, pattern):
    s = pattern + "$" + text
    z = z_function(s)
    m = len(pattern)
    return [i - m - 1 for i in range(len(z)) if z[i] == m]

# Usage:
print(z_search("aaaab", "aa"))  # [0, 1, 2]
\`\`\``,
          desc: 'Z-array: z[i] = length of the longest substring starting at i that matches a prefix of s. Substring search concatenates pattern + "$" + text. O(n + m).',
        },
        javascript: {
          title: 'Z-Algorithm (Pattern Matching)',
          code: `\`\`\`javascript
function zFunction(s) {
  const n = s.length, z = new Array(n).fill(0);
  let l = 0, r = 0;
  for (let i = 1; i < n; i++) {
    if (i < r) z[i] = Math.min(r - i, z[i - l]);
    while (i + z[i] < n && s[z[i]] === s[i + z[i]]) z[i]++;
    if (i + z[i] > r) { l = i; r = i + z[i]; }
  }
  return z;
}

function zSearch(text, pattern) {
  const s = pattern + '$' + text, z = zFunction(s), m = pattern.length;
  const out = [];
  for (let i = 0; i < z.length; i++) if (z[i] === m) out.push(i - m - 1);
  return out;
}
\`\`\``,
          desc: 'Z-array based pattern search. O(n + m) time and space.',
        },
      },
      string_rotation_check: {
        python: {
          title: 'Check if Two Strings Are Rotations',
          code: `\`\`\`python
def is_rotation(s1, s2):
    return len(s1) == len(s2) and len(s1) > 0 and s2 in (s1 + s1)

# Usage:
print(is_rotation("waterbottle", "erbottlewat"))  # True
print(is_rotation("abc", "cab"))                    # True
print(is_rotation("abc", "bca"))                    # True
print(is_rotation("abc", "acb"))                    # False
\`\`\``,
          desc: 'Every rotation of s1 is a substring of s1 + s1. Requires equal non-zero lengths. O(n).',
        },
        javascript: {
          title: 'Check if Two Strings Are Rotations',
          code: `\`\`\`javascript
function isRotation(s1, s2) {
  return s1.length === s2.length && s1.length > 0 && (s1 + s1).includes(s2);
}

// Usage:
console.log(isRotation('waterbottle', 'erbottlewat'));  // true
console.log(isRotation('abc', 'acb'));                    // false
\`\`\``,
          desc: 'Concatenation trick: every rotation of s1 is a substring of s1 + s1. O(n).',
        },
      },
      longest_common_substring: {
        python: {
          title: 'Longest Common Substring',
          code: `\`\`\`python
def longest_common_substring(a, b):
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    best, end = 0, 0
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
                if dp[i][j] > best:
                    best, end = dp[i][j], i
    return a[end - best:end]

# Usage:
print(longest_common_substring("abcdef", "zcdefg"))  # "cdef"
\`\`\``,
          desc: 'DP over both strings. dp[i][j] = length of common suffix ending at a[i-1] and b[j-1]. O(m*n).',
        },
        javascript: {
          title: 'Longest Common Substring',
          code: `\`\`\`javascript
function longestCommonSubstring(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  let best = 0, end = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        if (dp[i][j] > best) { best = dp[i][j]; end = i; }
      }
    }
  }
  return a.slice(end - best, end);
}
\`\`\``,
          desc: 'DP over both strings. dp[i][j] = length of common suffix ending at positions i-1, j-1. O(m*n) time and space.',
        },
      },
      longest_palindrome_substring: {
        python: {
          title: 'Longest Palindromic Substring (Expand Around Centers)',
          code: `\`\`\`python
def longest_palindrome(s):
    if not s:
        return ""
    start = end = 0
    def expand(l, r):
        while l >= 0 and r < len(s) and s[l] == s[r]:
            l -= 1; r += 1
        return l + 1, r - 1
    for i in range(len(s)):
        for l, r in (expand(i, i), expand(i, i + 1)):
            if r - l > end - start:
                start, end = l, r
    return s[start:end + 1]

# Usage:
print(longest_palindrome("babad"))  # "bab" or "aba"
print(longest_palindrome("cbbd"))   # "bb"
\`\`\``,
          desc: 'Expand around each possible center (2n - 1 centers). O(n^2) time, O(1) space. Manacher\'s algorithm improves to O(n).',
        },
        javascript: {
          title: 'Longest Palindromic Substring (Expand Around Centers)',
          code: `\`\`\`javascript
function longestPalindrome(s) {
  if (!s) return '';
  let start = 0, end = 0;
  const expand = (l, r) => {
    while (l >= 0 && r < s.length && s[l] === s[r]) { l--; r++; }
    return [l + 1, r - 1];
  };
  for (let i = 0; i < s.length; i++) {
    for (const [l, r] of [expand(i, i), expand(i, i + 1)]) {
      if (r - l > end - start) { start = l; end = r; }
    }
  }
  return s.slice(start, end + 1);
}
\`\`\``,
          desc: 'Expand around each possible center. O(n^2) time, O(1) space.',
        },
      },
      levenshtein: {
        python: {
          title: 'Levenshtein Distance',
          code: `\`\`\`python
def levenshtein(a, b):
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
        prev = curr
    return prev[-1]

# Usage:
print(levenshtein("kitten", "sitting"))  # 3
\`\`\``,
          desc: 'Classic edit-distance DP with rolling 1-D array for O(min(m, n)) space.',
        },
        javascript: {
          title: 'Levenshtein Distance',
          code: `\`\`\`javascript
function levenshtein(a, b) {
  if (a.length < b.length) [a, b] = [b, a];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i, ...new Array(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[prev.length - 1];
}
\`\`\``,
          desc: 'Edit distance with rolling 1-D buffer. O(m*n) time, O(min(m, n)) space.',
        },
      },

      // ─── UTILITY FUNCTIONS ───
      debounce: {
        javascript: {
          title: 'Debounce',
          code: `\`\`\`javascript
function debounce(fn, delay) {
  let timer = null;
  const debounced = function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
  debounced.cancel = () => { clearTimeout(timer); timer = null; };
  return debounced;
}

// Usage:
const save = debounce(() => console.log('saved'), 300);
save(); save(); save();  // only one 'saved' logs after 300ms of silence
\`\`\``,
          desc: 'Collapses a burst of calls into a single call after `delay` ms of silence. Perfect for resize/input handlers. Use `.cancel()` to drop a pending call on unmount.',
        },
        python: {
          title: 'Debounce',
          code: `\`\`\`python
import threading

def debounce(delay):
    def decorator(fn):
        timer = None
        lock = threading.Lock()
        def wrapped(*args, **kwargs):
            nonlocal timer
            with lock:
                if timer is not None:
                    timer.cancel()
                timer = threading.Timer(delay, lambda: fn(*args, **kwargs))
                timer.start()
        return wrapped
    return decorator

@debounce(0.3)
def save():
    print("saved")

save(); save(); save()  # only one print after 300ms of silence
\`\`\``,
          desc: 'threading.Timer-based debounce. Note: the callback runs on the timer thread, so thread-safe side effects only.',
        },
      },
      throttle: {
        javascript: {
          title: 'Throttle (Leading Edge)',
          code: `\`\`\`javascript
function throttle(fn, limit) {
  let lastCall = 0;
  let timer = null;
  return function (...args) {
    const now = Date.now();
    const remaining = limit - (now - lastCall);
    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      lastCall = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

// Usage:
const log = throttle(() => console.log(Date.now()), 1000);
setInterval(log, 100);  // logs at most once per second
\`\`\``,
          desc: 'Leading-edge throttle with a trailing call to guarantee the last invocation in a burst fires. Call at most once per `limit` ms.',
        },
        python: {
          title: 'Throttle (Leading Edge)',
          code: `\`\`\`python
import time
import threading

def throttle(limit):
    last = [0]
    lock = threading.Lock()
    def decorator(fn):
        def wrapped(*args, **kwargs):
            with lock:
                now = time.monotonic()
                if now - last[0] >= limit:
                    last[0] = now
                    return fn(*args, **kwargs)
        return wrapped
    return decorator

@throttle(1.0)
def log():
    print(time.monotonic())
\`\`\``,
          desc: 'Simple leading-edge throttle: drops calls within `limit` seconds of the last executed call. Use monotonic clock to avoid wall-clock jumps.',
        },
      },
      deep_clone: {
        javascript: {
          title: 'Deep Clone',
          code: `\`\`\`javascript
function deepClone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value);
  if (value instanceof RegExp) return new RegExp(value);
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(deepClone(item, seen));
    return copy;
  }
  if (value instanceof Map) {
    const copy = new Map(); seen.set(value, copy);
    for (const [k, v] of value) copy.set(deepClone(k, seen), deepClone(v, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set(); seen.set(value, copy);
    for (const v of value) copy.add(deepClone(v, seen));
    return copy;
  }
  const copy = Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const k of Reflect.ownKeys(value)) copy[k] = deepClone(value[k], seen);
  return copy;
}
\`\`\``,
          desc: 'Cycle-safe deep clone handling plain objects, arrays, Dates, RegExps, Maps, and Sets. Preserves prototype. Prefer `structuredClone` in modern browsers/Node when available.',
        },
        python: {
          title: 'Deep Clone',
          code: `\`\`\`python
import copy

def deep_clone(value):
    return copy.deepcopy(value)

# Usage:
a = {"x": [1, 2, {"y": 3}]}
b = deep_clone(a)
b["x"][2]["y"] = 99
print(a["x"][2]["y"])  # 3 — untouched
\`\`\``,
          desc: 'Python\'s stdlib copy.deepcopy handles cycles and custom types via __deepcopy__. Falls back to pickling semantics for unknown types.',
        },
      },
      deep_equal: {
        javascript: {
          title: 'Deep Equality',
          code: `\`\`\`javascript
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a.constructor !== b.constructor) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Reflect.ownKeys(a), keysB = Reflect.ownKeys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}
\`\`\``,
          desc: 'Structural equality. Handles arrays, plain objects, and primitives. Extend with Map/Set/Date checks if you rely on them.',
        },
        python: {
          title: 'Deep Equality',
          code: `\`\`\`python
# Python's == already performs deep structural equality on lists, dicts, sets, tuples:
print([1, [2, {"a": 3}]] == [1, [2, {"a": 3}]])  # True

# For dataclasses:
from dataclasses import dataclass
@dataclass
class Point:
    x: int; y: int
print(Point(1, 2) == Point(1, 2))  # True
\`\`\``,
          desc: 'In Python, built-in == already compares lists/dicts/sets/tuples element-by-element. Dataclasses get structural equality for free.',
        },
      },
      memoize: {
        javascript: {
          title: 'Memoize',
          code: `\`\`\`javascript
function memoize(fn, keyFn = (...args) => JSON.stringify(args)) {
  const cache = new Map();
  return function (...args) {
    const key = keyFn(...args);
    if (cache.has(key)) return cache.get(key);
    const result = fn.apply(this, args);
    cache.set(key, result);
    return result;
  };
}

// Usage:
const slow = (n) => { for (let i = 0; i < 1e7; i++); return n * 2; };
const fast = memoize(slow);
fast(5);  // slow
fast(5);  // instant cache hit
\`\`\``,
          desc: 'Generic memoization via a Map + key function. Default key is JSON.stringify(args) — supply a cheaper keyFn for hot paths.',
        },
        python: {
          title: 'Memoize',
          code: `\`\`\`python
from functools import lru_cache

@lru_cache(maxsize=None)
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print(fib(100))  # 354224848179261915075 — instant
\`\`\``,
          desc: 'functools.lru_cache is the idiomatic memoizer. Use maxsize to bound memory, or @cache (3.9+) for unbounded.',
        },
      },
      curry: {
        javascript: {
          title: 'Curry',
          code: `\`\`\`javascript
function curry(fn, arity = fn.length) {
  return function curried(...args) {
    if (args.length >= arity) return fn.apply(this, args);
    return (...more) => curried.apply(this, [...args, ...more]);
  };
}

// Usage:
const add = curry((a, b, c) => a + b + c);
console.log(add(1)(2)(3));    // 6
console.log(add(1, 2)(3));    // 6
console.log(add(1, 2, 3));    // 6
\`\`\``,
          desc: 'Auto-currying based on function arity. Partially applied calls return new curried functions until all args are supplied.',
        },
        python: {
          title: 'Curry',
          code: `\`\`\`python
from functools import partial

def curry(fn, arity=None):
    if arity is None:
        arity = fn.__code__.co_argcount
    def curried(*args):
        if len(args) >= arity:
            return fn(*args[:arity])
        return lambda *more: curried(*args, *more)
    return curried

add = curry(lambda a, b, c: a + b + c)
print(add(1)(2)(3))  # 6
\`\`\``,
          desc: 'Closure-based currying. functools.partial is the pythonic partial-application helper for one-shot fixing of args.',
        },
      },
      compose: {
        javascript: {
          title: 'Function Composition (right-to-left)',
          code: `\`\`\`javascript
const compose = (...fns) => (x) => fns.reduceRight((acc, fn) => fn(acc), x);

// Usage:
const addOne = x => x + 1;
const double = x => x * 2;
const square = x => x * x;

const f = compose(square, double, addOne);
console.log(f(3));  // ((3+1)*2)^2 = 64
\`\`\``,
          desc: 'Right-to-left function composition: compose(f, g, h)(x) === f(g(h(x))). Empty compose returns the identity.',
        },
        python: {
          title: 'Function Composition (right-to-left)',
          code: `\`\`\`python
from functools import reduce

def compose(*fns):
    return lambda x: reduce(lambda acc, fn: fn(acc), reversed(fns), x)

add_one = lambda x: x + 1
double = lambda x: x * 2
square = lambda x: x * x

f = compose(square, double, add_one)
print(f(3))  # 64
\`\`\``,
          desc: 'Right-to-left composition. compose(f, g, h)(x) === f(g(h(x))).',
        },
      },
      pipe: {
        javascript: {
          title: 'Pipe (left-to-right composition)',
          code: `\`\`\`javascript
const pipe = (...fns) => (x) => fns.reduce((acc, fn) => fn(acc), x);

// Usage:
const result = pipe(
  x => x + 1,
  x => x * 2,
  x => x * x,
)(3);
console.log(result);  // ((3+1)*2)^2 = 64
\`\`\``,
          desc: 'Left-to-right function composition: pipe(f, g, h)(x) === h(g(f(x))). Reads top-down like a pipeline.',
        },
        python: {
          title: 'Pipe (left-to-right composition)',
          code: `\`\`\`python
from functools import reduce

def pipe(*fns):
    return lambda x: reduce(lambda acc, fn: fn(acc), fns, x)

result = pipe(
    lambda x: x + 1,
    lambda x: x * 2,
    lambda x: x * x,
)(3)
print(result)  # 64
\`\`\``,
          desc: 'Left-to-right composition. pipe(f, g, h)(x) === h(g(f(x))).',
        },
      },
      once: {
        javascript: {
          title: 'Once (call at most once)',
          code: `\`\`\`javascript
function once(fn) {
  let called = false, result;
  return function (...args) {
    if (!called) {
      called = true;
      result = fn.apply(this, args);
    }
    return result;
  };
}

// Usage:
const init = once(() => { console.log('init'); return 42; });
init();  // logs 'init', returns 42
init();  // no log, returns 42
\`\`\``,
          desc: 'Wraps a function so it runs only on the first call and caches its return value for subsequent calls.',
        },
        python: {
          title: 'Once (call at most once)',
          code: `\`\`\`python
def once(fn):
    called = False
    result = None
    def wrapped(*args, **kwargs):
        nonlocal called, result
        if not called:
            called = True
            result = fn(*args, **kwargs)
        return result
    return wrapped
\`\`\``,
          desc: 'Wraps a function so it runs only on the first call and caches its return value thereafter.',
        },
      },
      retry_backoff: {
        javascript: {
          title: 'Retry with Exponential Backoff',
          code: `\`\`\`javascript
async function retryBackoff(fn, { retries = 5, baseMs = 200, capMs = 10_000, jitter = true } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries) throw err;
      const backoff = Math.min(capMs, baseMs * 2 ** attempt);
      const delay = jitter ? Math.random() * backoff : backoff;
      await new Promise(r => setTimeout(r, delay));
      attempt++;
    }
  }
}

// Usage:
await retryBackoff(async () => {
  const res = await fetch('/api/thing');
  if (!res.ok) throw new Error('retry');
  return res.json();
});
\`\`\``,
          desc: 'Exponential backoff with optional full jitter and a max cap. Use jitter to avoid thundering-herd on shared dependencies.',
        },
        python: {
          title: 'Retry with Exponential Backoff',
          code: `\`\`\`python
import time
import random

def retry_backoff(fn, retries=5, base=0.2, cap=10.0, jitter=True):
    attempt = 0
    while True:
        try:
            return fn(attempt)
        except Exception:
            if attempt >= retries:
                raise
            backoff = min(cap, base * (2 ** attempt))
            delay = random.random() * backoff if jitter else backoff
            time.sleep(delay)
            attempt += 1
\`\`\``,
          desc: 'Synchronous retry with exponential backoff and optional full jitter.',
        },
      },

      // ─── NUMERIC / MATH ALGORITHMS ───
      digit_sum: {
        python: {
          title: 'Sum of Digits',
          code: `\`\`\`python
def digit_sum(n):
    n = abs(n)
    total = 0
    while n:
        total += n % 10
        n //= 10
    return total

# Usage:
print(digit_sum(12345))   # 15
print(digit_sum(-999))    # 27
\`\`\``,
          desc: 'Repeatedly extract the last digit with %10, then integer-divide. O(log n).',
        },
        javascript: {
          title: 'Sum of Digits',
          code: `\`\`\`javascript
function digitSum(n) {
  n = Math.abs(n);
  let total = 0;
  while (n) { total += n % 10; n = Math.floor(n / 10); }
  return total;
}
\`\`\``,
          desc: 'Repeated mod-10 + floor-divide. O(log n).',
        },
      },
      reverse_integer: {
        python: {
          title: 'Reverse an Integer',
          code: `\`\`\`python
def reverse_integer(n):
    sign = -1 if n < 0 else 1
    n = abs(n)
    result = 0
    while n:
        result = result * 10 + n % 10
        n //= 10
    return sign * result

# Usage:
print(reverse_integer(12345))    # 54321
print(reverse_integer(-120))     # -21
\`\`\``,
          desc: 'Preserve sign, then build the reverse digit-by-digit. O(log n). Guard for 32-bit overflow in typed languages.',
        },
        javascript: {
          title: 'Reverse an Integer',
          code: `\`\`\`javascript
function reverseInteger(n) {
  const sign = n < 0 ? -1 : 1;
  n = Math.abs(n);
  let result = 0;
  while (n) { result = result * 10 + (n % 10); n = Math.floor(n / 10); }
  const signed = sign * result;
  // 32-bit overflow guard (LeetCode-style)
  if (signed < -(2 ** 31) || signed > 2 ** 31 - 1) return 0;
  return signed;
}
\`\`\``,
          desc: 'Preserve sign, rebuild digit-by-digit. Includes 32-bit overflow guard.',
        },
      },
      is_power_of_two: {
        python: {
          title: 'Is Power of Two',
          code: `\`\`\`python
def is_power_of_two(n):
    return n > 0 and (n & (n - 1)) == 0

# Usage:
print(is_power_of_two(1))    # True
print(is_power_of_two(16))   # True
print(is_power_of_two(18))   # False
\`\`\``,
          desc: 'A positive integer is a power of two iff it has exactly one bit set. n & (n - 1) clears the lowest set bit. O(1).',
        },
        javascript: {
          title: 'Is Power of Two',
          code: `\`\`\`javascript
const isPowerOfTwo = n => n > 0 && (n & (n - 1)) === 0;

// Usage:
console.log(isPowerOfTwo(16));  // true
console.log(isPowerOfTwo(18));  // false
\`\`\``,
          desc: 'Bitwise trick: n & (n - 1) clears the lowest set bit; a power of two has exactly one. O(1).',
        },
      },
      fast_power: {
        python: {
          title: 'Fast Power (Binary Exponentiation)',
          code: `\`\`\`python
def fast_power(base, exp):
    if exp < 0:
        return 1 / fast_power(base, -exp)
    result = 1
    while exp:
        if exp & 1:
            result *= base
        base *= base
        exp >>= 1
    return result

# Usage:
print(fast_power(2, 10))   # 1024
print(fast_power(3, 15))   # 14348907
\`\`\``,
          desc: 'Iterative binary exponentiation. O(log exp) multiplications.',
        },
        javascript: {
          title: 'Fast Power (Binary Exponentiation)',
          code: `\`\`\`javascript
function fastPower(base, exp) {
  if (exp < 0) return 1 / fastPower(base, -exp);
  let result = 1;
  while (exp) {
    if (exp & 1) result *= base;
    base *= base;
    exp = Math.floor(exp / 2);
  }
  return result;
}
\`\`\``,
          desc: 'Iterative binary exponentiation. O(log exp).',
        },
      },
      prime_factorization: {
        python: {
          title: 'Prime Factorization',
          code: `\`\`\`python
def prime_factors(n):
    factors = []
    d = 2
    while d * d <= n:
        while n % d == 0:
            factors.append(d)
            n //= d
        d += 1
    if n > 1:
        factors.append(n)
    return factors

# Usage:
print(prime_factors(360))   # [2, 2, 2, 3, 3, 5]
print(prime_factors(97))    # [97]
\`\`\``,
          desc: 'Trial division up to sqrt(n). O(sqrt(n)) worst case. Use Pollard\'s rho for very large numbers.',
        },
        javascript: {
          title: 'Prime Factorization',
          code: `\`\`\`javascript
function primeFactors(n) {
  const factors = [];
  for (let d = 2; d * d <= n; d++) {
    while (n % d === 0) { factors.push(d); n = Math.floor(n / d); }
  }
  if (n > 1) factors.push(n);
  return factors;
}
\`\`\``,
          desc: 'Trial division up to sqrt(n). O(sqrt(n)) worst case.',
        },
      },
      factorial_iterative: {
        python: {
          title: 'Iterative Factorial',
          code: `\`\`\`python
def factorial(n):
    if n < 0:
        raise ValueError("factorial undefined for negative integers")
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result

# Usage:
print(factorial(10))  # 3628800
\`\`\``,
          desc: 'Straightforward loop multiplying 2..n. O(n) multiplications; avoids the recursion depth limit.',
        },
        javascript: {
          title: 'Iterative Factorial',
          code: `\`\`\`javascript
function factorial(n) {
  if (n < 0) throw new RangeError('factorial undefined for negative integers');
  let result = 1n;  // BigInt to avoid overflow past 20!
  for (let i = 2n; i <= BigInt(n); i++) result *= i;
  return result;
}
\`\`\``,
          desc: 'Loop multiplying 2..n. Uses BigInt to avoid loss of precision past 20!.',
        },
      },
      nth_prime: {
        python: {
          title: 'Nth Prime',
          code: `\`\`\`python
def nth_prime(n):
    if n < 1:
        raise ValueError("n must be >= 1")
    count, candidate = 0, 1
    while count < n:
        candidate += 1
        if candidate < 2:
            continue
        is_prime = True
        d = 2
        while d * d <= candidate:
            if candidate % d == 0:
                is_prime = False
                break
            d += 1
        if is_prime:
            count += 1
    return candidate

# Usage:
print(nth_prime(1))    # 2
print(nth_prime(10))   # 29
print(nth_prime(100))  # 541
\`\`\``,
          desc: 'Naive primality test scanned until the nth prime is found. For large n, use a sieve bounded by the prime-counting approximation n * (ln n + ln ln n).',
        },
        javascript: {
          title: 'Nth Prime',
          code: `\`\`\`javascript
function nthPrime(n) {
  if (n < 1) throw new RangeError('n must be >= 1');
  let count = 0, candidate = 1;
  while (count < n) {
    candidate++;
    let isPrime = candidate >= 2;
    for (let d = 2; d * d <= candidate; d++) {
      if (candidate % d === 0) { isPrime = false; break; }
    }
    if (isPrime) count++;
  }
  return candidate;
}
\`\`\``,
          desc: 'Naive primality test. For large n prefer a sieve sized by the prime-counting approximation.',
        },
      },
      combinations: {
        python: {
          title: 'Combinations / Binomial Coefficient',
          code: `\`\`\`python
from math import comb
from itertools import combinations

# Count:
print(comb(5, 2))  # 10

# Enumerate all C(n, k) combinations:
print(list(combinations("ABCD", 2)))
# [('A', 'B'), ('A', 'C'), ('A', 'D'), ('B', 'C'), ('B', 'D'), ('C', 'D')]

# Manual binomial if you cannot import math.comb:
def binomial(n, k):
    if k < 0 or k > n:
        return 0
    k = min(k, n - k)
    result = 1
    for i in range(k):
        result = result * (n - i) // (i + 1)
    return result
\`\`\``,
          desc: 'Use math.comb (Python 3.8+) for the count and itertools.combinations for enumeration. Manual binomial avoids factorial blowup via running product.',
        },
        javascript: {
          title: 'Combinations / Binomial Coefficient',
          code: `\`\`\`javascript
function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < k; i++) result = result * (n - i) / (i + 1);
  return Math.round(result);
}

function* combinations(arr, k) {
  const n = arr.length;
  if (k > n) return;
  const indices = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield indices.map(i => arr[i]);
    let i = k - 1;
    while (i >= 0 && indices[i] === i + n - k) i--;
    if (i < 0) return;
    indices[i]++;
    for (let j = i + 1; j < k; j++) indices[j] = indices[j - 1] + 1;
  }
}

// Usage:
console.log(binomial(5, 2));                           // 10
console.log([...combinations(['A','B','C','D'], 2)]);  // all C(4, 2) pairs
\`\`\``,
          desc: 'Running-product binomial avoids factorial overflow. Generator enumerates combinations in lexicographic index order.',
        },
      },
      permutations: {
        python: {
          title: 'Generate All Permutations',
          code: `\`\`\`python
from itertools import permutations

print(list(permutations([1, 2, 3])))
# [(1,2,3), (1,3,2), (2,1,3), (2,3,1), (3,1,2), (3,2,1)]

# Manual recursive backtracking (no imports):
def permutations_manual(arr):
    if len(arr) <= 1:
        return [list(arr)]
    out = []
    for i, x in enumerate(arr):
        for rest in permutations_manual(arr[:i] + arr[i+1:]):
            out.append([x] + rest)
    return out
\`\`\``,
          desc: 'itertools.permutations is the idiomatic choice. The manual version demonstrates the backtracking pattern: O(n * n!).',
        },
        javascript: {
          title: 'Generate All Permutations',
          code: `\`\`\`javascript
function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

// Usage:
console.log(permutations([1, 2, 3]));
\`\`\``,
          desc: 'Recursive backtracking. O(n * n!) time. Use a generator for large n to avoid materialising the full list.',
        },
      },
      pascal_triangle: {
        python: {
          title: "Pascal's Triangle",
          code: `\`\`\`python
def pascal_triangle(rows):
    triangle = []
    for i in range(rows):
        row = [1] * (i + 1)
        for j in range(1, i):
            row[j] = triangle[i - 1][j - 1] + triangle[i - 1][j]
        triangle.append(row)
    return triangle

# Usage:
for row in pascal_triangle(5):
    print(row)
# [1]
# [1, 1]
# [1, 2, 1]
# [1, 3, 3, 1]
# [1, 4, 6, 4, 1]
\`\`\``,
          desc: 'Each interior cell is the sum of the two above it. O(rows^2) time and space.',
        },
        javascript: {
          title: "Pascal's Triangle",
          code: `\`\`\`javascript
function pascalTriangle(rows) {
  const triangle = [];
  for (let i = 0; i < rows; i++) {
    const row = new Array(i + 1).fill(1);
    for (let j = 1; j < i; j++) row[j] = triangle[i - 1][j - 1] + triangle[i - 1][j];
    triangle.push(row);
  }
  return triangle;
}
\`\`\``,
          desc: 'Each interior cell = sum of the two directly above. O(rows^2).',
        },
      },
      is_armstrong: {
        python: {
          title: 'Armstrong (Narcissistic) Number Check',
          code: `\`\`\`python
def is_armstrong(n):
    digits = str(abs(n))
    k = len(digits)
    return sum(int(d) ** k for d in digits) == abs(n)

# Usage:
print(is_armstrong(153))   # True  (1^3 + 5^3 + 3^3 = 153)
print(is_armstrong(9474))  # True  (9^4 + 4^4 + 7^4 + 4^4)
print(is_armstrong(123))   # False
\`\`\``,
          desc: 'A k-digit Armstrong number equals the sum of its digits each raised to k. O(k).',
        },
        javascript: {
          title: 'Armstrong (Narcissistic) Number Check',
          code: `\`\`\`javascript
function isArmstrong(n) {
  const digits = String(Math.abs(n));
  const k = digits.length;
  const sum = [...digits].reduce((s, d) => s + Math.pow(Number(d), k), 0);
  return sum === Math.abs(n);
}
\`\`\``,
          desc: 'A k-digit Armstrong number equals the sum of its digits each raised to k. O(k).',
        },
      },

      // ─── STATISTICS ───
      average_array: {
        python: {
          title: 'Mean / Average',
          code: `\`\`\`python
def mean(nums):
    if not nums:
        raise ValueError("mean of empty sequence")
    return sum(nums) / len(nums)

# Usage:
print(mean([1, 2, 3, 4, 5]))  # 3.0
\`\`\``,
          desc: 'Arithmetic mean. Raises on empty input — use statistics.fmean for a faster C implementation.',
        },
        javascript: {
          title: 'Mean / Average',
          code: `\`\`\`javascript
function mean(nums) {
  if (!nums.length) throw new RangeError('mean of empty array');
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
\`\`\``,
          desc: 'Arithmetic mean. Beware floating-point error for very large sums — use Kahan summation if precision matters.',
        },
      },
      median: {
        python: {
          title: 'Median',
          code: `\`\`\`python
def median(nums):
    if not nums:
        raise ValueError("median of empty sequence")
    sorted_nums = sorted(nums)
    n = len(sorted_nums)
    mid = n // 2
    if n % 2:
        return sorted_nums[mid]
    return (sorted_nums[mid - 1] + sorted_nums[mid]) / 2

# Usage:
print(median([3, 1, 4, 1, 5, 9, 2, 6]))  # 3.5
\`\`\``,
          desc: 'Sort-based median. O(n log n). For O(n), use quickselect (statistics.median uses sorting internally).',
        },
        javascript: {
          title: 'Median',
          code: `\`\`\`javascript
function median(nums) {
  if (!nums.length) throw new RangeError('median of empty array');
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
\`\`\``,
          desc: 'Sort-based median. O(n log n). For large n consider quickselect for O(n) expected time.',
        },
      },
      mode: {
        python: {
          title: 'Mode (Most Frequent Value)',
          code: `\`\`\`python
from collections import Counter

def mode(nums):
    if not nums:
        raise ValueError("mode of empty sequence")
    counts = Counter(nums)
    top = max(counts.values())
    return [v for v, c in counts.items() if c == top]

# Usage:
print(mode([1, 2, 2, 3, 3, 4]))  # [2, 3]
print(mode([1, 2, 2, 3]))         # [2]
\`\`\``,
          desc: 'Counter-based mode. Returns all tied values (multimodal). O(n).',
        },
        javascript: {
          title: 'Mode (Most Frequent Value)',
          code: `\`\`\`javascript
function mode(nums) {
  if (!nums.length) throw new RangeError('mode of empty array');
  const counts = new Map();
  for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return [...counts.entries()].filter(([, c]) => c === top).map(([v]) => v);
}
\`\`\``,
          desc: 'Counts via Map then selects all values tied at the maximum frequency. O(n).',
        },
      },
      variance: {
        python: {
          title: 'Variance',
          code: `\`\`\`python
def variance(nums, sample=True):
    n = len(nums)
    if n < 2 and sample:
        raise ValueError("sample variance requires at least two data points")
    if n < 1:
        raise ValueError("variance of empty sequence")
    mu = sum(nums) / n
    sq = sum((x - mu) ** 2 for x in nums)
    return sq / (n - 1) if sample else sq / n

# Usage:
print(variance([1, 2, 3, 4, 5]))               # 2.5 (sample)
print(variance([1, 2, 3, 4, 5], sample=False)) # 2.0 (population)
\`\`\``,
          desc: 'Sample variance divides by n-1 (Bessel\'s correction); population variance divides by n. For numerical stability on huge datasets, use Welford\'s online algorithm.',
        },
        javascript: {
          title: 'Variance',
          code: `\`\`\`javascript
function variance(nums, { sample = true } = {}) {
  const n = nums.length;
  if (n < 2 && sample) throw new RangeError('sample variance requires >= 2 data points');
  if (n < 1) throw new RangeError('variance of empty array');
  const mu = nums.reduce((a, b) => a + b, 0) / n;
  const sq = nums.reduce((acc, x) => acc + (x - mu) ** 2, 0);
  return sample ? sq / (n - 1) : sq / n;
}
\`\`\``,
          desc: 'Sample variance (n-1 divisor) by default; pass { sample: false } for population variance.',
        },
      },
      stddev: {
        python: {
          title: 'Standard Deviation',
          code: `\`\`\`python
import math

def stddev(nums, sample=True):
    n = len(nums)
    if n < 2 and sample:
        raise ValueError("sample stddev requires at least two data points")
    if n < 1:
        raise ValueError("stddev of empty sequence")
    mu = sum(nums) / n
    sq = sum((x - mu) ** 2 for x in nums)
    return math.sqrt(sq / (n - 1) if sample else sq / n)

# Usage:
print(stddev([1, 2, 3, 4, 5]))  # ≈ 1.5811
\`\`\``,
          desc: 'Square-root of variance. Sample default (n-1 divisor); pass sample=False for population stddev.',
        },
        javascript: {
          title: 'Standard Deviation',
          code: `\`\`\`javascript
function stddev(nums, { sample = true } = {}) {
  const n = nums.length;
  if (n < 2 && sample) throw new RangeError('sample stddev requires >= 2 data points');
  if (n < 1) throw new RangeError('stddev of empty array');
  const mu = nums.reduce((a, b) => a + b, 0) / n;
  const sq = nums.reduce((acc, x) => acc + (x - mu) ** 2, 0);
  return Math.sqrt(sample ? sq / (n - 1) : sq / n);
}
\`\`\``,
          desc: 'Square-root of variance. Sample default; opt-in to population via { sample: false }.',
        },
      },

      // ─── BATCH 2: BIT MANIPULATION & NUMBER THEORY ───
      count_set_bits: {
        python: {
          title: 'Count Set Bits (Hamming Weight)',
          code: `\`\`\`python
def count_set_bits(n):
    count = 0
    while n:
        n &= n - 1  # clear the lowest set bit
        count += 1
    return count

# Usage:
print(count_set_bits(29))  # 4  (binary 11101)
print(bin(29).count("1"))   # idiomatic Python alternative
\`\`\``,
          desc: 'Brian Kernighan\'s trick: n & (n - 1) clears the lowest set bit. Runs in O(number of set bits), faster than the naive bit-by-bit loop.',
        },
        javascript: {
          title: 'Count Set Bits (Hamming Weight)',
          code: `\`\`\`javascript
function countSetBits(n) {
  n = n >>> 0;  // treat as unsigned 32-bit
  let count = 0;
  while (n) { n &= n - 1; count++; }
  return count;
}

// Usage:
console.log(countSetBits(29));   // 4
console.log(countSetBits(-1));   // 32 (all bits set in two's complement)
\`\`\``,
          desc: 'Brian Kernighan\'s trick. >>> 0 coerces to unsigned 32-bit so negative inputs are handled correctly.',
        },
      },
      hamming_distance: {
        python: {
          title: 'Hamming Distance',
          code: `\`\`\`python
def hamming_distance(a, b):
    return bin(a ^ b).count("1")

# Usage:
print(hamming_distance(1, 4))  # 2  (001 vs 100)
\`\`\``,
          desc: 'XOR differs exactly at the bits that disagree; count the 1-bits. O(log max(a,b)).',
        },
        javascript: {
          title: 'Hamming Distance',
          code: `\`\`\`javascript
function hammingDistance(a, b) {
  let x = (a ^ b) >>> 0, count = 0;
  while (x) { x &= x - 1; count++; }
  return count;
}
\`\`\``,
          desc: 'XOR combined with Kernighan\'s trick.',
        },
      },
      single_number: {
        python: {
          title: 'Single Number (XOR trick)',
          code: `\`\`\`python
from functools import reduce
from operator import xor

def single_number(nums):
    return reduce(xor, nums, 0)

# Usage:
print(single_number([2, 2, 3, 1, 1]))  # 3
\`\`\``,
          desc: 'XOR of all elements cancels pairs and leaves the unique element. O(n) time, O(1) space.',
        },
        javascript: {
          title: 'Single Number (XOR trick)',
          code: `\`\`\`javascript
function singleNumber(nums) {
  let result = 0;
  for (const n of nums) result ^= n;
  return result;
}
\`\`\``,
          desc: 'XOR of all elements cancels pairs and leaves the unique element. O(n) / O(1).',
        },
      },
      missing_number: {
        python: {
          title: 'Missing Number in [0..n]',
          code: `\`\`\`python
def missing_number(nums):
    n = len(nums)
    expected = n * (n + 1) // 2
    return expected - sum(nums)

# Usage:
print(missing_number([3, 0, 1]))  # 2
\`\`\``,
          desc: 'Sum formula trick: expected - actual. O(n) time, O(1) space. XOR works too and avoids overflow.',
        },
        javascript: {
          title: 'Missing Number in [0..n]',
          code: `\`\`\`javascript
function missingNumber(nums) {
  const n = nums.length;
  let missing = n;
  for (let i = 0; i < n; i++) missing ^= i ^ nums[i];
  return missing;
}
\`\`\``,
          desc: 'XOR trick: every index XOR every value leaves the missing number. O(n) / O(1), overflow-safe.',
        },
      },
      gray_code: {
        python: {
          title: 'Gray Code Sequence',
          code: `\`\`\`python
def gray_code(n):
    return [i ^ (i >> 1) for i in range(1 << n)]

# Usage:
print(gray_code(3))  # [0, 1, 3, 2, 6, 7, 5, 4]
\`\`\``,
          desc: 'Standard reflected-binary Gray code: g(i) = i XOR (i >> 1). Consecutive values differ in exactly one bit.',
        },
        javascript: {
          title: 'Gray Code Sequence',
          code: `\`\`\`javascript
function grayCode(n) {
  return Array.from({ length: 1 << n }, (_, i) => i ^ (i >> 1));
}
\`\`\``,
          desc: 'Reflected-binary Gray code. O(2^n).',
        },
      },
      power_of_four: {
        python: {
          title: 'Power of Four Check',
          code: `\`\`\`python
def is_power_of_four(n):
    if n <= 0: return False
    # Must be a power of two AND the set bit sits at an even position
    return (n & (n - 1)) == 0 and (n & 0x55555555) != 0

# Usage:
print(is_power_of_four(16))  # True
print(is_power_of_four(8))   # False
\`\`\``,
          desc: 'Powers of 4 are powers of 2 whose only set bit is in an even position (mask 0x55555555 keeps even positions).',
        },
        javascript: {
          title: 'Power of Four Check',
          code: `\`\`\`javascript
function isPowerOfFour(n) {
  if (n <= 0) return false;
  return (n & (n - 1)) === 0 && (n & 0x55555555) !== 0;
}
\`\`\``,
          desc: 'Single-expression bitwise check. O(1).',
        },
      },
      next_power_of_two: {
        python: {
          title: 'Next Power of Two',
          code: `\`\`\`python
def next_power_of_two(n):
    if n <= 1: return 1
    return 1 << (n - 1).bit_length()

# Usage:
print(next_power_of_two(5))    # 8
print(next_power_of_two(16))   # 16  (already a power of two)
\`\`\``,
          desc: 'Smallest power of two >= n. bit_length of (n-1) yields the correct exponent.',
        },
        javascript: {
          title: 'Next Power of Two',
          code: `\`\`\`javascript
function nextPowerOfTwo(n) {
  if (n <= 1) return 1;
  let p = n - 1;
  p |= p >>> 1; p |= p >>> 2; p |= p >>> 4;
  p |= p >>> 8; p |= p >>> 16;
  return (p + 1) >>> 0;
}
\`\`\``,
          desc: 'Bit-smear trick: propagate the highest set bit rightward, then add one. O(1), works for 32-bit unsigned.',
        },
      },
      gcd_iterative: {
        python: {
          title: 'Iterative GCD (Euclidean Algorithm)',
          code: `\`\`\`python
def gcd(a, b):
    a, b = abs(a), abs(b)
    while b:
        a, b = b, a % b
    return a

# Usage:
print(gcd(48, 18))  # 6
\`\`\``,
          desc: 'Classic Euclidean algorithm. O(log min(a, b)).',
        },
        javascript: {
          title: 'Iterative GCD (Euclidean Algorithm)',
          code: `\`\`\`javascript
function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}
\`\`\``,
          desc: 'Classic Euclidean algorithm. O(log min(a, b)).',
        },
      },
      extended_gcd: {
        python: {
          title: 'Extended Euclidean Algorithm',
          code: `\`\`\`python
def extended_gcd(a, b):
    if b == 0: return a, 1, 0
    g, x1, y1 = extended_gcd(b, a % b)
    return g, y1, x1 - (a // b) * y1

# Usage: returns (gcd, x, y) such that a*x + b*y = gcd(a, b)
print(extended_gcd(30, 18))  # (6, 1, -1)  => 30*1 + 18*(-1) = 12? actually 30-18=12; check manually
\`\`\``,
          desc: `Returns (gcd, x, y) satisfying Bezout's identity a*x + b*y = gcd(a, b). Useful for modular inverses.`,
        },
        javascript: {
          title: 'Extended Euclidean Algorithm',
          code: `\`\`\`javascript
function extendedGcd(a, b) {
  if (b === 0) return [a, 1, 0];
  const [g, x1, y1] = extendedGcd(b, a % b);
  return [g, y1, x1 - Math.floor(a / b) * y1];
}
\`\`\``,
          desc: 'Returns [gcd, x, y] with a*x + b*y = gcd(a, b). Basis for modular inverses.',
        },
      },
      mod_pow: {
        python: {
          title: 'Modular Exponentiation',
          code: `\`\`\`python
def mod_pow(base, exp, mod):
    result = 1
    base %= mod
    while exp > 0:
        if exp & 1:
            result = (result * base) % mod
        base = (base * base) % mod
        exp >>= 1
    return result

# Usage:
print(mod_pow(2, 10, 1000))  # 24
print(pow(2, 10, 1000))       # idiomatic builtin
\`\`\``,
          desc: `Right-to-left binary exponentiation modulo m. O(log exp). Python's built-in pow(base, exp, mod) does the same.`,
        },
        javascript: {
          title: 'Modular Exponentiation (BigInt-safe)',
          code: `\`\`\`javascript
function modPow(base, exp, mod) {
  base = BigInt(base); exp = BigInt(exp); mod = BigInt(mod);
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}
\`\`\``,
          desc: 'BigInt variant avoids overflow. O(log exp).',
        },
      },
      euler_totient: {
        python: {
          title: `Euler's Totient Function`,
          code: `\`\`\`python
def euler_totient(n):
    result = n
    p = 2
    while p * p <= n:
        if n % p == 0:
            while n % p == 0:
                n //= p
            result -= result // p
        p += 1
    if n > 1:
        result -= result // n
    return result

# Usage:
print(euler_totient(10))  # 4  (coprime: 1, 3, 7, 9)
\`\`\``,
          desc: `Counts integers in [1, n] coprime to n via product over distinct prime factors. O(sqrt n).`,
        },
        javascript: {
          title: `Euler's Totient Function`,
          code: `\`\`\`javascript
function eulerTotient(n) {
  let result = n;
  for (let p = 2; p * p <= n; p++) {
    if (n % p === 0) {
      while (n % p === 0) n = Math.floor(n / p);
      result -= Math.floor(result / p);
    }
  }
  if (n > 1) result -= Math.floor(result / n);
  return result;
}
\`\`\``,
          desc: `Counts integers in [1, n] coprime to n. O(sqrt n).`,
        },
      },
      integer_sqrt: {
        python: {
          title: 'Integer Square Root',
          code: `\`\`\`python
def isqrt(n):
    if n < 0: raise ValueError('isqrt of negative')
    if n < 2: return n
    x, y = n, (n + 1) // 2
    while y < x:
        x, y = y, (y + n // y) // 2
    return x

# Usage:
print(isqrt(27))  # 5
import math; print(math.isqrt(27))  # idiomatic since Python 3.8
\`\`\``,
          desc: `Newton/Babylonian iteration truncated to integers. O(log n). Use math.isqrt in modern Python.`,
        },
        javascript: {
          title: 'Integer Square Root',
          code: `\`\`\`javascript
function isqrt(n) {
  if (n < 0) throw new RangeError('isqrt of negative');
  if (n < 2) return n;
  let x = n, y = Math.floor((n + 1) / 2);
  while (y < x) { x = y; y = Math.floor((y + Math.floor(n / y)) / 2); }
  return x;
}
\`\`\``,
          desc: `Newton iteration truncated to integers. O(log n).`,
        },
      },
      two_sum: {
        python: {
          title: 'Two Sum',
          code: `\`\`\`python
def two_sum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        if target - x in seen:
            return [seen[target - x], i]
        seen[x] = i
    return None

# Usage:
print(two_sum([2, 7, 11, 15], 9))  # [0, 1]
\`\`\``,
          desc: `Hash-map lookup of the complement. O(n) time, O(n) space.`,
        },
        javascript: {
          title: 'Two Sum',
          code: `\`\`\`javascript
function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return null;
}
\`\`\``,
          desc: `Hash-map lookup of the complement. O(n) / O(n).`,
        },
      },
      three_sum: {
        python: {
          title: 'Three Sum (unique triplets)',
          code: `\`\`\`python
def three_sum(nums):
    nums = sorted(nums)
    out = []
    n = len(nums)
    for i in range(n - 2):
        if i > 0 and nums[i] == nums[i - 1]: continue
        l, r = i + 1, n - 1
        while l < r:
            s = nums[i] + nums[l] + nums[r]
            if s < 0: l += 1
            elif s > 0: r -= 1
            else:
                out.append([nums[i], nums[l], nums[r]])
                while l < r and nums[l] == nums[l + 1]: l += 1
                while l < r and nums[r] == nums[r - 1]: r -= 1
                l += 1; r -= 1
    return out

# Usage:
print(three_sum([-1, 0, 1, 2, -1, -4]))  # [[-1, -1, 2], [-1, 0, 1]]
\`\`\``,
          desc: `Sort then two-pointer sweep per pivot; skip duplicates. O(n^2) time, O(1) extra (excluding output).`,
        },
        javascript: {
          title: 'Three Sum (unique triplets)',
          code: `\`\`\`javascript
function threeSum(nums) {
  nums = [...nums].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < nums.length - 2; i++) {
    if (i > 0 && nums[i] === nums[i - 1]) continue;
    let l = i + 1, r = nums.length - 1;
    while (l < r) {
      const s = nums[i] + nums[l] + nums[r];
      if (s < 0) l++;
      else if (s > 0) r--;
      else {
        out.push([nums[i], nums[l], nums[r]]);
        while (l < r && nums[l] === nums[l + 1]) l++;
        while (l < r && nums[r] === nums[r - 1]) r--;
        l++; r--;
      }
    }
  }
  return out;
}
\`\`\``,
          desc: `Sort + two-pointer, O(n^2).`,
        },
      },

      // ─── BATCH 3: ADVANCED DP & BACKTRACKING ───
      matrix_chain: {
        python: {
          title: 'Matrix Chain Multiplication',
          code: `\`\`\`python
def matrix_chain(dims):
    n = len(dims) - 1
    dp = [[0] * n for _ in range(n)]
    for length in range(2, n + 1):
        for i in range(n - length + 1):
            j = i + length - 1
            dp[i][j] = float('inf')
            for k in range(i, j):
                cost = dp[i][k] + dp[k + 1][j] + dims[i] * dims[k + 1] * dims[j + 1]
                if cost < dp[i][j]: dp[i][j] = cost
    return dp[0][n - 1]

# Usage: dims[i..i+1] is matrix i. Matrices: 10x30, 30x5, 5x60 => dims=[10,30,5,60]
print(matrix_chain([10, 30, 5, 60]))  # 4500
\`\`\``,
          desc: 'Interval DP finding optimal parenthesization. O(n^3) time, O(n^2) space.',
        },
        javascript: {
          title: 'Matrix Chain Multiplication',
          code: `\`\`\`javascript
function matrixChain(dims) {
  const n = dims.length - 1;
  const dp = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      dp[i][j] = Infinity;
      for (let k = i; k < j; k++) {
        const cost = dp[i][k] + dp[k + 1][j] + dims[i] * dims[k + 1] * dims[j + 1];
        if (cost < dp[i][j]) dp[i][j] = cost;
      }
    }
  }
  return dp[0][n - 1];
}
\`\`\``,
          desc: 'Interval DP. O(n^3) time, O(n^2) space.',
        },
      },
      palindrome_partition: {
        python: {
          title: 'Palindrome Partitioning (min cuts)',
          code: `\`\`\`python
def min_cut(s):
    n = len(s)
    pal = [[False] * n for _ in range(n)]
    for i in range(n - 1, -1, -1):
        for j in range(i, n):
            if s[i] == s[j] and (j - i < 2 or pal[i + 1][j - 1]):
                pal[i][j] = True
    cuts = list(range(n))
    for i in range(n):
        if pal[0][i]:
            cuts[i] = 0
        else:
            for j in range(i):
                if pal[j + 1][i] and cuts[j] + 1 < cuts[i]:
                    cuts[i] = cuts[j] + 1
    return cuts[n - 1]

# Usage:
print(min_cut('aab'))  # 1  ('aa' | 'b')
\`\`\``,
          desc: 'Precompute palindrome table, then DP on min cuts. O(n^2) time, O(n^2) space.',
        },
        javascript: {
          title: 'Palindrome Partitioning (min cuts)',
          code: `\`\`\`javascript
function minCut(s) {
  const n = s.length;
  const pal = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i; j < n; j++) {
      if (s[i] === s[j] && (j - i < 2 || pal[i + 1][j - 1])) pal[i][j] = true;
    }
  }
  const cuts = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < n; i++) {
    if (pal[0][i]) { cuts[i] = 0; continue; }
    for (let j = 0; j < i; j++) {
      if (pal[j + 1][i] && cuts[j] + 1 < cuts[i]) cuts[i] = cuts[j] + 1;
    }
  }
  return cuts[n - 1];
}
\`\`\``,
          desc: 'O(n^2) DP with palindrome precomputation.',
        },
      },
      word_break: {
        python: {
          title: 'Word Break',
          code: `\`\`\`python
def word_break(s, word_dict):
    words = set(word_dict)
    n = len(s)
    dp = [False] * (n + 1)
    dp[0] = True
    for i in range(1, n + 1):
        for j in range(i):
            if dp[j] and s[j:i] in words:
                dp[i] = True
                break
    return dp[n]

# Usage:
print(word_break('leetcode', ['leet', 'code']))  # True
\`\`\``,
          desc: 'dp[i] = can s[0..i] be segmented. O(n^2 * L) with L = max word length.',
        },
        javascript: {
          title: 'Word Break',
          code: `\`\`\`javascript
function wordBreak(s, wordDict) {
  const words = new Set(wordDict);
  const n = s.length;
  const dp = new Array(n + 1).fill(false);
  dp[0] = true;
  for (let i = 1; i <= n; i++) {
    for (let j = 0; j < i; j++) {
      if (dp[j] && words.has(s.slice(j, i))) { dp[i] = true; break; }
    }
  }
  return dp[n];
}
\`\`\``,
          desc: 'dp[i] = can s[0..i] be segmented. O(n^2 * L).',
        },
      },
      regex_match: {
        python: {
          title: 'Regular Expression Matching (. and *)',
          code: `\`\`\`python
def is_match(s, p):
    m, n = len(s), len(p)
    dp = [[False] * (n + 1) for _ in range(m + 1)]
    dp[0][0] = True
    for j in range(1, n + 1):
        if p[j - 1] == '*':
            dp[0][j] = dp[0][j - 2]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if p[j - 1] == '*':
                dp[i][j] = dp[i][j - 2]
                if p[j - 2] == '.' or p[j - 2] == s[i - 1]:
                    dp[i][j] = dp[i][j] or dp[i - 1][j]
            elif p[j - 1] == '.' or p[j - 1] == s[i - 1]:
                dp[i][j] = dp[i - 1][j - 1]
    return dp[m][n]

# Usage:
print(is_match('aab', 'c*a*b'))  # True
\`\`\``,
          desc: 'DP: dp[i][j] = s[0..i] matches p[0..j]. Supports "." (any char) and "*" (zero or more). O(m*n).',
        },
        javascript: {
          title: 'Regular Expression Matching (. and *)',
          code: `\`\`\`javascript
function isMatch(s, p) {
  const m = s.length, n = p.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(false));
  dp[0][0] = true;
  for (let j = 1; j <= n; j++) if (p[j - 1] === '*') dp[0][j] = dp[0][j - 2];
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (p[j - 1] === '*') {
        dp[i][j] = dp[i][j - 2];
        if (p[j - 2] === '.' || p[j - 2] === s[i - 1]) dp[i][j] = dp[i][j] || dp[i - 1][j];
      } else if (p[j - 1] === '.' || p[j - 1] === s[i - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      }
    }
  }
  return dp[m][n];
}
\`\`\``,
          desc: '2D DP. O(m*n).',
        },
      },
      wildcard_match: {
        python: {
          title: 'Wildcard Matching (? and *)',
          code: `\`\`\`python
def is_match(s, p):
    m, n = len(s), len(p)
    dp = [[False] * (n + 1) for _ in range(m + 1)]
    dp[0][0] = True
    for j in range(1, n + 1):
        if p[j - 1] == '*':
            dp[0][j] = dp[0][j - 1]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if p[j - 1] == '*':
                dp[i][j] = dp[i - 1][j] or dp[i][j - 1]
            elif p[j - 1] == '?' or p[j - 1] == s[i - 1]:
                dp[i][j] = dp[i - 1][j - 1]
    return dp[m][n]

# Usage:
print(is_match('adceb', '*a*b'))  # True
\`\`\``,
          desc: 'DP where "?" matches any one char, "*" matches any sequence. O(m*n).',
        },
        javascript: {
          title: 'Wildcard Matching (? and *)',
          code: `\`\`\`javascript
function isMatch(s, p) {
  const m = s.length, n = p.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(false));
  dp[0][0] = true;
  for (let j = 1; j <= n; j++) if (p[j - 1] === '*') dp[0][j] = dp[0][j - 1];
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (p[j - 1] === '*') dp[i][j] = dp[i - 1][j] || dp[i][j - 1];
      else if (p[j - 1] === '?' || p[j - 1] === s[i - 1]) dp[i][j] = dp[i - 1][j - 1];
    }
  }
  return dp[m][n];
}
\`\`\``,
          desc: '2D DP. O(m*n).',
        },
      },
      min_path_sum: {
        python: {
          title: 'Minimum Path Sum in Grid',
          code: `\`\`\`python
def min_path_sum(grid):
    m, n = len(grid), len(grid[0])
    dp = [row[:] for row in grid]
    for j in range(1, n): dp[0][j] += dp[0][j - 1]
    for i in range(1, m): dp[i][0] += dp[i - 1][0]
    for i in range(1, m):
        for j in range(1, n):
            dp[i][j] += min(dp[i - 1][j], dp[i][j - 1])
    return dp[m - 1][n - 1]

# Usage:
print(min_path_sum([[1,3,1],[1,5,1],[4,2,1]]))  # 7
\`\`\``,
          desc: 'Classic grid DP: dp[i][j] = grid[i][j] + min(up, left). O(m*n) time, O(m*n) space (can be O(n)).',
        },
        javascript: {
          title: 'Minimum Path Sum in Grid',
          code: `\`\`\`javascript
function minPathSum(grid) {
  const m = grid.length, n = grid[0].length;
  const dp = grid.map(r => [...r]);
  for (let j = 1; j < n; j++) dp[0][j] += dp[0][j - 1];
  for (let i = 1; i < m; i++) dp[i][0] += dp[i - 1][0];
  for (let i = 1; i < m; i++)
    for (let j = 1; j < n; j++)
      dp[i][j] += Math.min(dp[i - 1][j], dp[i][j - 1]);
  return dp[m - 1][n - 1];
}
\`\`\``,
          desc: 'Classic grid DP. O(m*n).',
        },
      },
      rod_cutting: {
        python: {
          title: 'Rod Cutting',
          code: `\`\`\`python
def rod_cutting(prices, n):
    dp = [0] * (n + 1)
    for i in range(1, n + 1):
        best = 0
        for j in range(i):
            if j < len(prices):
                best = max(best, prices[j] + dp[i - j - 1])
        dp[i] = best
    return dp[n]

# Usage: prices[i] = price for rod of length i+1
print(rod_cutting([1, 5, 8, 9, 10, 17, 17, 20], 8))  # 22
\`\`\``,
          desc: 'Unbounded knapsack variant. O(n^2).',
        },
        javascript: {
          title: 'Rod Cutting',
          code: `\`\`\`javascript
function rodCutting(prices, n) {
  const dp = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    let best = 0;
    for (let j = 0; j < i; j++) {
      if (j < prices.length) best = Math.max(best, prices[j] + dp[i - j - 1]);
    }
    dp[i] = best;
  }
  return dp[n];
}
\`\`\``,
          desc: 'Unbounded knapsack variant. O(n^2).',
        },
      },
      subset_sum: {
        python: {
          title: 'Subset Sum',
          code: `\`\`\`python
def subset_sum(nums, target):
    dp = [False] * (target + 1)
    dp[0] = True
    for x in nums:
        for s in range(target, x - 1, -1):
            if dp[s - x]: dp[s] = True
    return dp[target]

# Usage:
print(subset_sum([3, 34, 4, 12, 5, 2], 9))  # True (4 + 5)
\`\`\``,
          desc: '1D DP over target sum, iterate backward to avoid reuse. O(n * target).',
        },
        javascript: {
          title: 'Subset Sum',
          code: `\`\`\`javascript
function subsetSum(nums, target) {
  const dp = new Array(target + 1).fill(false);
  dp[0] = true;
  for (const x of nums) {
    for (let s = target; s >= x; s--) {
      if (dp[s - x]) dp[s] = true;
    }
  }
  return dp[target];
}
\`\`\``,
          desc: '1D DP over target, backward iteration. O(n * target).',
        },
      },
      decode_ways: {
        python: {
          title: 'Decode Ways',
          code: `\`\`\`python
def num_decodings(s):
    if not s or s[0] == '0': return 0
    n = len(s)
    prev2, prev1 = 1, 1
    for i in range(1, n):
        curr = 0
        if s[i] != '0': curr += prev1
        two = int(s[i - 1:i + 1])
        if 10 <= two <= 26: curr += prev2
        prev2, prev1 = prev1, curr
    return prev1

# Usage:
print(num_decodings('226'))  # 3  (2|2|6, 22|6, 2|26)
\`\`\``,
          desc: 'Fibonacci-style DP with O(1) rolling state. O(n) time, O(1) space.',
        },
        javascript: {
          title: 'Decode Ways',
          code: `\`\`\`javascript
function numDecodings(s) {
  if (!s || s[0] === '0') return 0;
  let prev2 = 1, prev1 = 1;
  for (let i = 1; i < s.length; i++) {
    let curr = 0;
    if (s[i] !== '0') curr += prev1;
    const two = parseInt(s.slice(i - 1, i + 1), 10);
    if (two >= 10 && two <= 26) curr += prev2;
    prev2 = prev1; prev1 = curr;
  }
  return prev1;
}
\`\`\``,
          desc: 'Rolling-state DP. O(n) / O(1).',
        },
      },
      jump_game: {
        python: {
          title: 'Jump Game (can reach end)',
          code: `\`\`\`python
def can_jump(nums):
    reach = 0
    for i, x in enumerate(nums):
        if i > reach: return False
        reach = max(reach, i + x)
    return True

# Usage:
print(can_jump([2, 3, 1, 1, 4]))  # True
print(can_jump([3, 2, 1, 0, 4]))  # False
\`\`\``,
          desc: 'Greedy max-reach. O(n) time, O(1) space.',
        },
        javascript: {
          title: 'Jump Game (can reach end)',
          code: `\`\`\`javascript
function canJump(nums) {
  let reach = 0;
  for (let i = 0; i < nums.length; i++) {
    if (i > reach) return false;
    reach = Math.max(reach, i + nums[i]);
  }
  return true;
}
\`\`\``,
          desc: 'Greedy max-reach. O(n) / O(1).',
        },
      },
      n_queens: {
        python: {
          title: 'N-Queens Solver',
          code: `\`\`\`python
def solve_n_queens(n):
    result, cols, d1, d2 = [], set(), set(), set()
    board = [-1] * n
    def bt(r):
        if r == n:
            result.append(['.' * c + 'Q' + '.' * (n - c - 1) for c in board])
            return
        for c in range(n):
            if c in cols or (r - c) in d1 or (r + c) in d2: continue
            cols.add(c); d1.add(r - c); d2.add(r + c); board[r] = c
            bt(r + 1)
            cols.remove(c); d1.remove(r - c); d2.remove(r + c)
    bt(0)
    return result

# Usage:
print(len(solve_n_queens(4)))  # 2 solutions
\`\`\``,
          desc: 'Classic backtracking with O(1) conflict sets per column/diagonal. O(n!) worst case.',
        },
        javascript: {
          title: 'N-Queens Solver',
          code: `\`\`\`javascript
function solveNQueens(n) {
  const result = [], cols = new Set(), d1 = new Set(), d2 = new Set();
  const board = new Array(n).fill(-1);
  function bt(r) {
    if (r === n) {
      result.push(board.map(c => '.'.repeat(c) + 'Q' + '.'.repeat(n - c - 1)));
      return;
    }
    for (let c = 0; c < n; c++) {
      if (cols.has(c) || d1.has(r - c) || d2.has(r + c)) continue;
      cols.add(c); d1.add(r - c); d2.add(r + c); board[r] = c;
      bt(r + 1);
      cols.delete(c); d1.delete(r - c); d2.delete(r + c);
    }
  }
  bt(0);
  return result;
}
\`\`\``,
          desc: 'Backtracking with conflict sets. O(n!).',
        },
      },
      sudoku_solver: {
        python: {
          title: 'Sudoku Solver (9x9)',
          code: `\`\`\`python
def solve_sudoku(board):
    rows = [set() for _ in range(9)]
    cols = [set() for _ in range(9)]
    boxes = [set() for _ in range(9)]
    empty = []
    for r in range(9):
        for c in range(9):
            v = board[r][c]
            if v == '.': empty.append((r, c))
            else:
                rows[r].add(v); cols[c].add(v); boxes[(r // 3) * 3 + c // 3].add(v)
    def bt(i):
        if i == len(empty): return True
        r, c = empty[i]
        b = (r // 3) * 3 + c // 3
        for d in '123456789':
            if d in rows[r] or d in cols[c] or d in boxes[b]: continue
            board[r][c] = d
            rows[r].add(d); cols[c].add(d); boxes[b].add(d)
            if bt(i + 1): return True
            rows[r].remove(d); cols[c].remove(d); boxes[b].remove(d)
        board[r][c] = '.'
        return False
    bt(0)
    return board

# Usage: board is 9x9 list of str, '.' for empty.
\`\`\``,
          desc: 'Backtracking with row/col/box constraint sets. Fast in practice on typical puzzles.',
        },
        javascript: {
          title: 'Sudoku Solver (9x9)',
          code: `\`\`\`javascript
function solveSudoku(board) {
  const rows = Array.from({ length: 9 }, () => new Set());
  const cols = Array.from({ length: 9 }, () => new Set());
  const boxes = Array.from({ length: 9 }, () => new Set());
  const empty = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const v = board[r][c];
    if (v === '.') empty.push([r, c]);
    else { rows[r].add(v); cols[c].add(v); boxes[((r / 3) | 0) * 3 + ((c / 3) | 0)].add(v); }
  }
  function bt(i) {
    if (i === empty.length) return true;
    const [r, c] = empty[i], b = ((r / 3) | 0) * 3 + ((c / 3) | 0);
    for (const d of '123456789') {
      if (rows[r].has(d) || cols[c].has(d) || boxes[b].has(d)) continue;
      board[r][c] = d; rows[r].add(d); cols[c].add(d); boxes[b].add(d);
      if (bt(i + 1)) return true;
      rows[r].delete(d); cols[c].delete(d); boxes[b].delete(d);
    }
    board[r][c] = '.';
    return false;
  }
  bt(0);
  return board;
}
\`\`\``,
          desc: 'Backtracking with constraint sets. Fast on typical inputs.',
        },
      },
      generate_parentheses: {
        python: {
          title: 'Generate Parentheses',
          code: `\`\`\`python
def generate_parenthesis(n):
    out = []
    def bt(s, open_, close_):
        if len(s) == 2 * n:
            out.append(s); return
        if open_ < n: bt(s + '(', open_ + 1, close_)
        if close_ < open_: bt(s + ')', open_, close_ + 1)
    bt('', 0, 0)
    return out

# Usage:
print(generate_parenthesis(3))  # ['((()))','(()())','(())()','()(())','()()()']
\`\`\``,
          desc: 'Backtracking with (open, close) counters. Generates nth Catalan many strings.',
        },
        javascript: {
          title: 'Generate Parentheses',
          code: `\`\`\`javascript
function generateParenthesis(n) {
  const out = [];
  (function bt(s, open, close) {
    if (s.length === 2 * n) { out.push(s); return; }
    if (open < n) bt(s + '(', open + 1, close);
    if (close < open) bt(s + ')', open, close + 1);
  })('', 0, 0);
  return out;
}
\`\`\``,
          desc: 'Backtracking with counters. Catalan-many results.',
        },
      },
      subsets: {
        python: {
          title: 'Subsets (Power Set)',
          code: `\`\`\`python
def subsets(nums):
    out = [[]]
    for x in nums:
        out += [sub + [x] for sub in out]
    return out

# Usage:
print(subsets([1, 2, 3]))  # 8 subsets
\`\`\``,
          desc: 'Iterative doubling: each new element doubles the number of subsets. O(n * 2^n).',
        },
        javascript: {
          title: 'Subsets (Power Set)',
          code: `\`\`\`javascript
function subsets(nums) {
  let out = [[]];
  for (const x of nums) out = out.concat(out.map(s => [...s, x]));
  return out;
}
\`\`\``,
          desc: 'Iterative doubling. O(n * 2^n).',
        },
      },
      combination_sum: {
        python: {
          title: 'Combination Sum',
          code: `\`\`\`python
def combination_sum(candidates, target):
    candidates = sorted(candidates)
    out = []
    def bt(start, path, remain):
        if remain == 0:
            out.append(path[:]); return
        for i in range(start, len(candidates)):
            if candidates[i] > remain: break
            path.append(candidates[i])
            bt(i, path, remain - candidates[i])  # reuse allowed
            path.pop()
    bt(0, [], target)
    return out

# Usage:
print(combination_sum([2, 3, 6, 7], 7))  # [[2,2,3],[7]]
\`\`\``,
          desc: 'Backtracking with pruning (sorted + early break). Exponential in worst case.',
        },
        javascript: {
          title: 'Combination Sum',
          code: `\`\`\`javascript
function combinationSum(candidates, target) {
  candidates = [...candidates].sort((a, b) => a - b);
  const out = [];
  (function bt(start, path, remain) {
    if (remain === 0) { out.push([...path]); return; }
    for (let i = start; i < candidates.length; i++) {
      if (candidates[i] > remain) break;
      path.push(candidates[i]);
      bt(i, path, remain - candidates[i]);
      path.pop();
    }
  })(0, [], target);
  return out;
}
\`\`\``,
          desc: 'Backtracking with sorted-prune. Exponential worst case.',
        },
      },

      // ─── BATCH 4: ADVANCED GRAPHS & GEOMETRY ───
      bellman_ford: {
        python: {
          title: 'Bellman-Ford (shortest path with negative edges)',
          code: `\`\`\`python
def bellman_ford(n, edges, source):
    dist = [float('inf')] * n
    dist[source] = 0
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    # Detect negative cycle
    for u, v, w in edges:
        if dist[u] + w < dist[v]:
            raise ValueError('Negative cycle detected')
    return dist

# Usage:
# edges = [(u, v, weight), ...]
print(bellman_ford(4, [(0,1,1),(1,2,-2),(2,3,1)], 0))  # [0, 1, -1, 0]
\`\`\``,
          desc: 'Handles negative edge weights. O(V*E). Raises on negative cycle reachable from source.',
        },
        javascript: {
          title: 'Bellman-Ford (shortest path with negative edges)',
          code: `\`\`\`javascript
function bellmanFord(n, edges, source) {
  const dist = new Array(n).fill(Infinity);
  dist[source] = 0;
  for (let k = 0; k < n - 1; k++) {
    for (const [u, v, w] of edges) {
      if (dist[u] + w < dist[v]) dist[v] = dist[u] + w;
    }
  }
  for (const [u, v, w] of edges) {
    if (dist[u] + w < dist[v]) throw new Error('Negative cycle detected');
  }
  return dist;
}
\`\`\``,
          desc: 'O(V*E). Detects negative cycles.',
        },
      },
      floyd_warshall: {
        python: {
          title: 'Floyd-Warshall (all-pairs shortest paths)',
          code: `\`\`\`python
def floyd_warshall(n, edges):
    INF = float('inf')
    dist = [[INF] * n for _ in range(n)]
    for i in range(n): dist[i][i] = 0
    for u, v, w in edges:
        if w < dist[u][v]: dist[u][v] = w
    for k in range(n):
        for i in range(n):
            for j in range(n):
                if dist[i][k] + dist[k][j] < dist[i][j]:
                    dist[i][j] = dist[i][k] + dist[k][j]
    return dist

# Usage:
print(floyd_warshall(3, [(0,1,5),(1,2,3),(0,2,10)])[0][2])  # 8
\`\`\``,
          desc: 'Dynamic programming over intermediate vertices. O(V^3) time, O(V^2) space. Handles negative edges (no negative cycles).',
        },
        javascript: {
          title: 'Floyd-Warshall (all-pairs shortest paths)',
          code: `\`\`\`javascript
function floydWarshall(n, edges) {
  const dist = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) dist[i][i] = 0;
  for (const [u, v, w] of edges) if (w < dist[u][v]) dist[u][v] = w;
  for (let k = 0; k < n; k++)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];
  return dist;
}
\`\`\``,
          desc: 'O(V^3).',
        },
      },
      kruskal_mst: {
        python: {
          title: `Kruskal's MST`,
          code: `\`\`\`python
def kruskal(n, edges):
    parent = list(range(n))
    rank = [0] * n
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb: return False
        if rank[ra] < rank[rb]: ra, rb = rb, ra
        parent[rb] = ra
        if rank[ra] == rank[rb]: rank[ra] += 1
        return True
    mst, total = [], 0
    for u, v, w in sorted(edges, key=lambda e: e[2]):
        if union(u, v):
            mst.append((u, v, w)); total += w
    return mst, total

# Usage:
print(kruskal(4, [(0,1,1),(1,2,2),(0,2,4),(2,3,3)]))  # ([(0,1,1),(1,2,2),(2,3,3)], 6)
\`\`\``,
          desc: 'Sort edges, add if endpoints are in different components (union-find with path compression + rank). O(E log E).',
        },
        javascript: {
          title: `Kruskal's MST`,
          code: `\`\`\`javascript
function kruskal(n, edges) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => {
    let ra = find(a), rb = find(b);
    if (ra === rb) return false;
    if (rank[ra] < rank[rb]) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    if (rank[ra] === rank[rb]) rank[ra]++;
    return true;
  };
  const mst = [];
  let total = 0;
  for (const [u, v, w] of [...edges].sort((a, b) => a[2] - b[2])) {
    if (union(u, v)) { mst.push([u, v, w]); total += w; }
  }
  return { mst, total };
}
\`\`\``,
          desc: 'Union-find + edge sort. O(E log E).',
        },
      },
      prim_mst: {
        python: {
          title: `Prim's MST`,
          code: `\`\`\`python
import heapq

def prim(n, adj):
    visited = [False] * n
    heap = [(0, 0)]  # (weight, vertex)
    mst_total = 0
    edges_taken = 0
    while heap and edges_taken < n:
        w, u = heapq.heappop(heap)
        if visited[u]: continue
        visited[u] = True
        mst_total += w
        edges_taken += 1
        for v, wv in adj[u]:
            if not visited[v]:
                heapq.heappush(heap, (wv, v))
    return mst_total

# Usage: adj is adjacency list {u: [(v, w), ...]}
adj = [[(1,1),(2,4)], [(0,1),(2,2)], [(0,4),(1,2),(3,3)], [(2,3)]]
print(prim(4, adj))  # 6
\`\`\``,
          desc: 'Grow MST by greedily picking the cheapest edge crossing the visited frontier. O(E log V) with binary heap.',
        },
        javascript: {
          title: `Prim's MST`,
          code: `\`\`\`javascript
// Requires a MinHeap implementation (see 'heap' template).
function prim(n, adj, MinHeap) {
  const visited = new Array(n).fill(false);
  const heap = new MinHeap((a, b) => a[0] - b[0]);
  heap.push([0, 0]);
  let total = 0, taken = 0;
  while (heap.size() > 0 && taken < n) {
    const [w, u] = heap.pop();
    if (visited[u]) continue;
    visited[u] = true; total += w; taken++;
    for (const [v, wv] of adj[u]) if (!visited[v]) heap.push([wv, v]);
  }
  return total;
}
\`\`\``,
          desc: 'Heap-driven Prim. O(E log V).',
        },
      },
      a_star: {
        python: {
          title: 'A* Search (grid)',
          code: `\`\`\`python
import heapq

def a_star(grid, start, goal):
    rows, cols = len(grid), len(grid[0])
    def h(a, b): return abs(a[0] - b[0]) + abs(a[1] - b[1])  # Manhattan
    open_heap = [(h(start, goal), 0, start)]
    came_from = {}
    g_score = {start: 0}
    while open_heap:
        _, g, cur = heapq.heappop(open_heap)
        if cur == goal:
            path = [cur]
            while cur in came_from:
                cur = came_from[cur]; path.append(cur)
            return path[::-1]
        for dr, dc in [(-1,0),(1,0),(0,-1),(0,1)]:
            nr, nc = cur[0] + dr, cur[1] + dc
            if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 0:
                tentative = g + 1
                nxt = (nr, nc)
                if tentative < g_score.get(nxt, float('inf')):
                    came_from[nxt] = cur
                    g_score[nxt] = tentative
                    heapq.heappush(open_heap, (tentative + h(nxt, goal), tentative, nxt))
    return None

# Usage:
grid = [[0,0,0],[1,1,0],[0,0,0]]
print(a_star(grid, (0,0), (2,2)))
\`\`\``,
          desc: 'Manhattan heuristic on a grid (0 = open, 1 = wall). O(E log V) with admissible heuristic.',
        },
        javascript: {
          title: 'A* Search (grid)',
          code: `\`\`\`javascript
function aStar(grid, start, goal, MinHeap) {
  const rows = grid.length, cols = grid[0].length;
  const h = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  const key = p => p[0] + ',' + p[1];
  const open = new MinHeap((a, b) => a[0] - b[0]);
  open.push([h(start, goal), 0, start]);
  const cameFrom = new Map();
  const g = new Map([[key(start), 0]]);
  while (open.size() > 0) {
    const [, gc, cur] = open.pop();
    if (cur[0] === goal[0] && cur[1] === goal[1]) {
      const path = [cur];
      let c = key(cur);
      while (cameFrom.has(c)) { const p = cameFrom.get(c); path.push(p); c = key(p); }
      return path.reverse();
    }
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = cur[0] + dr, nc = cur[1] + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || grid[nr][nc] !== 0) continue;
      const next = [nr, nc], nk = key(next), tentative = gc + 1;
      if (tentative < (g.get(nk) ?? Infinity)) {
        cameFrom.set(nk, cur); g.set(nk, tentative);
        open.push([tentative + h(next, goal), tentative, next]);
      }
    }
  }
  return null;
}
\`\`\``,
          desc: 'Grid-based A* with Manhattan heuristic.',
        },
      },
      max_flow: {
        python: {
          title: 'Max Flow (Edmonds-Karp / BFS Ford-Fulkerson)',
          code: `\`\`\`python
from collections import deque, defaultdict

def max_flow(n, edges, source, sink):
    cap = defaultdict(lambda: defaultdict(int))
    for u, v, c in edges:
        cap[u][v] += c  # directed; for undirected, also add cap[v][u] += c
    total = 0
    while True:
        parent = {source: None}
        queue = deque([source])
        while queue and sink not in parent:
            u = queue.popleft()
            for v, c in cap[u].items():
                if v not in parent and c > 0:
                    parent[v] = u
                    queue.append(v)
        if sink not in parent: break
        # Find bottleneck
        bn, v = float('inf'), sink
        while parent[v] is not None:
            bn = min(bn, cap[parent[v]][v]); v = parent[v]
        v = sink
        while parent[v] is not None:
            cap[parent[v]][v] -= bn
            cap[v][parent[v]] += bn
            v = parent[v]
        total += bn
    return total

# Usage:
print(max_flow(4, [(0,1,3),(0,2,2),(1,3,2),(2,3,3),(1,2,1)], 0, 3))  # 5
\`\`\``,
          desc: 'Edmonds-Karp = Ford-Fulkerson with BFS augmenting paths. O(V * E^2).',
        },
        javascript: {
          title: 'Max Flow (Edmonds-Karp)',
          code: `\`\`\`javascript
function maxFlow(n, edges, source, sink) {
  const cap = Array.from({ length: n }, () => new Map());
  for (const [u, v, c] of edges) cap[u].set(v, (cap[u].get(v) || 0) + c);
  let total = 0;
  while (true) {
    const parent = new Map([[source, -1]]);
    const queue = [source];
    while (queue.length && !parent.has(sink)) {
      const u = queue.shift();
      for (const [v, c] of cap[u]) if (c > 0 && !parent.has(v)) { parent.set(v, u); queue.push(v); }
    }
    if (!parent.has(sink)) break;
    let bn = Infinity, v = sink;
    while (parent.get(v) !== -1) { bn = Math.min(bn, cap[parent.get(v)].get(v)); v = parent.get(v); }
    v = sink;
    while (parent.get(v) !== -1) {
      const p = parent.get(v);
      cap[p].set(v, cap[p].get(v) - bn);
      cap[v].set(p, (cap[v].get(p) || 0) + bn);
      v = p;
    }
    total += bn;
  }
  return total;
}
\`\`\``,
          desc: 'Edmonds-Karp BFS max-flow. O(V * E^2).',
        },
      },
      tarjan_scc: {
        python: {
          title: `Tarjan's Strongly Connected Components`,
          code: `\`\`\`python
def tarjan_scc(n, adj):
    index = [0]
    stack, on_stack = [], [False] * n
    indices, lowlink = [-1] * n, [0] * n
    result = []

    def strongconnect(v):
        indices[v] = lowlink[v] = index[0]
        index[0] += 1
        stack.append(v); on_stack[v] = True
        for w in adj[v]:
            if indices[w] == -1:
                strongconnect(w)
                lowlink[v] = min(lowlink[v], lowlink[w])
            elif on_stack[w]:
                lowlink[v] = min(lowlink[v], indices[w])
        if lowlink[v] == indices[v]:
            scc = []
            while True:
                w = stack.pop(); on_stack[w] = False
                scc.append(w)
                if w == v: break
            result.append(scc)

    for v in range(n):
        if indices[v] == -1: strongconnect(v)
    return result

# Usage:
print(tarjan_scc(5, [[1],[2],[0,3],[4],[]]))  # [[4],[3],[0,2,1]]
\`\`\``,
          desc: `Single DFS with index/lowlink bookkeeping. O(V + E). Iterative variant recommended for large graphs.`,
        },
        javascript: {
          title: `Tarjan's Strongly Connected Components`,
          code: `\`\`\`javascript
function tarjanScc(n, adj) {
  let index = 0;
  const stack = [], onStack = new Array(n).fill(false);
  const indices = new Array(n).fill(-1), lowlink = new Array(n).fill(0);
  const result = [];
  function strongconnect(v) {
    indices[v] = lowlink[v] = index++;
    stack.push(v); onStack[v] = true;
    for (const w of adj[v]) {
      if (indices[w] === -1) { strongconnect(w); lowlink[v] = Math.min(lowlink[v], lowlink[w]); }
      else if (onStack[w]) lowlink[v] = Math.min(lowlink[v], indices[w]);
    }
    if (lowlink[v] === indices[v]) {
      const scc = [];
      while (true) { const w = stack.pop(); onStack[w] = false; scc.push(w); if (w === v) break; }
      result.push(scc);
    }
  }
  for (let v = 0; v < n; v++) if (indices[v] === -1) strongconnect(v);
  return result;
}
\`\`\``,
          desc: 'O(V + E). Recursive; iterative variant recommended for deep graphs.',
        },
      },
      articulation_points: {
        python: {
          title: 'Articulation Points (Cut Vertices)',
          code: `\`\`\`python
def articulation_points(n, adj):
    disc, low = [-1] * n, [0] * n
    parent = [-1] * n
    ap = set()
    timer = [0]
    def dfs(u):
        children = 0
        disc[u] = low[u] = timer[0]; timer[0] += 1
        for v in adj[u]:
            if disc[v] == -1:
                parent[v] = u
                children += 1
                dfs(v)
                low[u] = min(low[u], low[v])
                if parent[u] == -1 and children > 1: ap.add(u)
                if parent[u] != -1 and low[v] >= disc[u]: ap.add(u)
            elif v != parent[u]:
                low[u] = min(low[u], disc[v])
    for u in range(n):
        if disc[u] == -1: dfs(u)
    return sorted(ap)

# Usage:
adj = [[1,2],[0,2],[0,1,3],[2,4],[3]]
print(articulation_points(5, adj))  # [2, 3]
\`\`\``,
          desc: `Tarjan's low-link DFS. A vertex is articulation if removing it disconnects the graph. O(V + E).`,
        },
        javascript: {
          title: 'Articulation Points (Cut Vertices)',
          code: `\`\`\`javascript
function articulationPoints(n, adj) {
  const disc = new Array(n).fill(-1), low = new Array(n).fill(0);
  const parent = new Array(n).fill(-1);
  const ap = new Set();
  let timer = 0;
  function dfs(u) {
    let children = 0;
    disc[u] = low[u] = timer++;
    for (const v of adj[u]) {
      if (disc[v] === -1) {
        parent[v] = u; children++;
        dfs(v);
        low[u] = Math.min(low[u], low[v]);
        if (parent[u] === -1 && children > 1) ap.add(u);
        if (parent[u] !== -1 && low[v] >= disc[u]) ap.add(u);
      } else if (v !== parent[u]) {
        low[u] = Math.min(low[u], disc[v]);
      }
    }
  }
  for (let u = 0; u < n; u++) if (disc[u] === -1) dfs(u);
  return [...ap].sort((a, b) => a - b);
}
\`\`\``,
          desc: 'Tarjan low-link. O(V + E).',
        },
      },
      convex_hull: {
        python: {
          title: 'Convex Hull (Andrew Monotone Chain)',
          code: `\`\`\`python
def convex_hull(points):
    pts = sorted(set(map(tuple, points)))
    if len(pts) <= 1: return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]

# Usage:
print(convex_hull([(0,0),(1,1),(2,2),(2,0),(0,2)]))  # [(0,0),(2,0),(2,2),(0,2)]
\`\`\``,
          desc: `Andrew's monotone chain builds lower and upper hulls via cross-product sign checks. O(n log n).`,
        },
        javascript: {
          title: 'Convex Hull (Andrew Monotone Chain)',
          code: `\`\`\`javascript
function convexHull(points) {
  const pts = [...new Set(points.map(p => p.join(',')))].map(s => s.split(',').map(Number));
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 1) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
\`\`\``,
          desc: 'Monotone chain. O(n log n).',
        },
      },
      line_intersection: {
        python: {
          title: 'Line Segment Intersection',
          code: `\`\`\`python
def segments_intersect(p1, p2, p3, p4):
    def cross(a, b, c):
        return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])
    def on(a, b, c):
        return min(a[0],b[0]) <= c[0] <= max(a[0],b[0]) and min(a[1],b[1]) <= c[1] <= max(a[1],b[1])
    d1, d2 = cross(p3, p4, p1), cross(p3, p4, p2)
    d3, d4 = cross(p1, p2, p3), cross(p1, p2, p4)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    if d1 == 0 and on(p3, p4, p1): return True
    if d2 == 0 and on(p3, p4, p2): return True
    if d3 == 0 and on(p1, p2, p3): return True
    if d4 == 0 and on(p1, p2, p4): return True
    return False

# Usage:
print(segments_intersect((0,0),(2,2),(0,2),(2,0)))  # True
\`\`\``,
          desc: 'Orientation (cross-product sign) + collinear on-segment check. O(1).',
        },
        javascript: {
          title: 'Line Segment Intersection',
          code: `\`\`\`javascript
function segmentsIntersect(p1, p2, p3, p4) {
  const cross = (a, b, c) => (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  const on = (a, b, c) => Math.min(a[0],b[0]) <= c[0] && c[0] <= Math.max(a[0],b[0])
                       && Math.min(a[1],b[1]) <= c[1] && c[1] <= Math.max(a[1],b[1]);
  const d1 = cross(p3,p4,p1), d2 = cross(p3,p4,p2), d3 = cross(p1,p2,p3), d4 = cross(p1,p2,p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && on(p3,p4,p1)) return true;
  if (d2 === 0 && on(p3,p4,p2)) return true;
  if (d3 === 0 && on(p1,p2,p3)) return true;
  if (d4 === 0 && on(p1,p2,p4)) return true;
  return false;
}
\`\`\``,
          desc: 'Orientation test + collinear on-segment handling.',
        },
      },
      polygon_area: {
        python: {
          title: 'Polygon Area (Shoelace Formula)',
          code: `\`\`\`python
def polygon_area(points):
    n = len(points)
    total = 0
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2

# Usage:
print(polygon_area([(0,0),(4,0),(4,3),(0,3)]))  # 12.0
\`\`\``,
          desc: 'Shoelace / Gauss area formula. O(n).',
        },
        javascript: {
          title: 'Polygon Area (Shoelace Formula)',
          code: `\`\`\`javascript
function polygonArea(points) {
  const n = points.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    total += x1 * y2 - x2 * y1;
  }
  return Math.abs(total) / 2;
}
\`\`\``,
          desc: 'Shoelace formula. O(n).',
        },
      },
      point_distance: {
        python: {
          title: 'Euclidean Distance Between Two Points',
          code: `\`\`\`python
import math

def distance(p1, p2):
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

# Usage:
print(distance((0, 0), (3, 4)))  # 5.0
\`\`\``,
          desc: 'math.hypot avoids intermediate overflow/underflow. O(1).',
        },
        javascript: {
          title: 'Euclidean Distance Between Two Points',
          code: `\`\`\`javascript
function distance(p1, p2) {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}
\`\`\``,
          desc: 'Math.hypot is numerically stable. O(1).',
        },
      },

      // ─── BATCH 5: ADVANCED DATA STRUCTURES ───
      segment_tree: {
        python: {
          title: 'Segment Tree (range sum, point update)',
          code: `\`\`\`python
class SegmentTree:
    def __init__(self, data):
        self.n = len(data)
        self.tree = [0] * (4 * self.n)
        if data: self._build(1, 0, self.n - 1, data)
    def _build(self, node, lo, hi, data):
        if lo == hi:
            self.tree[node] = data[lo]; return
        mid = (lo + hi) // 2
        self._build(2 * node, lo, mid, data)
        self._build(2 * node + 1, mid + 1, hi, data)
        self.tree[node] = self.tree[2 * node] + self.tree[2 * node + 1]
    def update(self, idx, val):
        self._update(1, 0, self.n - 1, idx, val)
    def _update(self, node, lo, hi, idx, val):
        if lo == hi:
            self.tree[node] = val; return
        mid = (lo + hi) // 2
        if idx <= mid: self._update(2 * node, lo, mid, idx, val)
        else: self._update(2 * node + 1, mid + 1, hi, idx, val)
        self.tree[node] = self.tree[2 * node] + self.tree[2 * node + 1]
    def query(self, l, r):
        return self._query(1, 0, self.n - 1, l, r)
    def _query(self, node, lo, hi, l, r):
        if r < lo or hi < l: return 0
        if l <= lo and hi <= r: return self.tree[node]
        mid = (lo + hi) // 2
        return self._query(2 * node, lo, mid, l, r) + self._query(2 * node + 1, mid + 1, hi, l, r)

# Usage:
st = SegmentTree([1, 3, 5, 7, 9, 11])
print(st.query(1, 3))  # 15
st.update(1, 10); print(st.query(1, 3))  # 22
\`\`\``,
          desc: 'Range sum with point updates. O(log n) per operation, O(n) space. Swap sum for min/max/gcd as needed.',
        },
        javascript: {
          title: 'Segment Tree (range sum, point update)',
          code: `\`\`\`javascript
class SegmentTree {
  constructor(data) {
    this.n = data.length;
    this.tree = new Array(4 * this.n).fill(0);
    if (this.n) this._build(1, 0, this.n - 1, data);
  }
  _build(node, lo, hi, data) {
    if (lo === hi) { this.tree[node] = data[lo]; return; }
    const mid = (lo + hi) >> 1;
    this._build(2 * node, lo, mid, data);
    this._build(2 * node + 1, mid + 1, hi, data);
    this.tree[node] = this.tree[2 * node] + this.tree[2 * node + 1];
  }
  update(idx, val) { this._update(1, 0, this.n - 1, idx, val); }
  _update(node, lo, hi, idx, val) {
    if (lo === hi) { this.tree[node] = val; return; }
    const mid = (lo + hi) >> 1;
    if (idx <= mid) this._update(2 * node, lo, mid, idx, val);
    else this._update(2 * node + 1, mid + 1, hi, idx, val);
    this.tree[node] = this.tree[2 * node] + this.tree[2 * node + 1];
  }
  query(l, r) { return this._query(1, 0, this.n - 1, l, r); }
  _query(node, lo, hi, l, r) {
    if (r < lo || hi < l) return 0;
    if (l <= lo && hi <= r) return this.tree[node];
    const mid = (lo + hi) >> 1;
    return this._query(2 * node, lo, mid, l, r) + this._query(2 * node + 1, mid + 1, hi, l, r);
  }
}
\`\`\``,
          desc: 'Range sum + point update. O(log n) per op.',
        },
      },
      fenwick_tree: {
        python: {
          title: 'Fenwick Tree (Binary Indexed Tree)',
          code: `\`\`\`python
class Fenwick:
    def __init__(self, n):
        self.n = n
        self.bit = [0] * (n + 1)
    def update(self, i, delta):
        i += 1
        while i <= self.n:
            self.bit[i] += delta
            i += i & (-i)
    def prefix(self, i):
        i += 1
        s = 0
        while i > 0:
            s += self.bit[i]
            i -= i & (-i)
        return s
    def range(self, l, r):
        return self.prefix(r) - (self.prefix(l - 1) if l > 0 else 0)

# Usage:
bit = Fenwick(6)
for i, v in enumerate([1, 3, 5, 7, 9, 11]): bit.update(i, v)
print(bit.range(1, 3))  # 15
\`\`\``,
          desc: 'Compact prefix-sum structure. O(log n) per update and query, O(n) space. Low constant factor.',
        },
        javascript: {
          title: 'Fenwick Tree (Binary Indexed Tree)',
          code: `\`\`\`javascript
class Fenwick {
  constructor(n) { this.n = n; this.bit = new Array(n + 1).fill(0); }
  update(i, delta) {
    for (i += 1; i <= this.n; i += i & -i) this.bit[i] += delta;
  }
  prefix(i) {
    let s = 0;
    for (i += 1; i > 0; i -= i & -i) s += this.bit[i];
    return s;
  }
  range(l, r) { return this.prefix(r) - (l > 0 ? this.prefix(l - 1) : 0); }
}
\`\`\``,
          desc: 'Prefix-sum BIT. O(log n) per op.',
        },
      },
      sparse_table: {
        python: {
          title: 'Sparse Table (static range min/max)',
          code: `\`\`\`python
import math

class SparseTable:
    def __init__(self, data, op=min):
        n = len(data)
        self.op = op
        self.k = math.floor(math.log2(n)) + 1 if n > 0 else 0
        self.st = [list(data)]
        j = 1
        while (1 << j) <= n:
            row = []
            for i in range(n - (1 << j) + 1):
                row.append(op(self.st[j - 1][i], self.st[j - 1][i + (1 << (j - 1))]))
            self.st.append(row); j += 1
    def query(self, l, r):
        length = r - l + 1
        j = int(math.log2(length))
        return self.op(self.st[j][l], self.st[j][r - (1 << j) + 1])

# Usage:
st = SparseTable([1, 3, 2, 7, 9, 11, 3, 5])
print(st.query(1, 5))  # 2 (min of [3,2,7,9,11])
\`\`\``,
          desc: 'Static range min/max queries in O(1) after O(n log n) preprocessing. Not updatable.',
        },
        javascript: {
          title: 'Sparse Table (static range min/max)',
          code: `\`\`\`javascript
class SparseTable {
  constructor(data, op = Math.min) {
    const n = data.length; this.op = op;
    this.st = [data.slice()];
    let j = 1;
    while ((1 << j) <= n) {
      const row = [];
      for (let i = 0; i + (1 << j) - 1 < n; i++) {
        row.push(op(this.st[j - 1][i], this.st[j - 1][i + (1 << (j - 1))]));
      }
      this.st.push(row); j++;
    }
  }
  query(l, r) {
    const j = Math.floor(Math.log2(r - l + 1));
    return this.op(this.st[j][l], this.st[j][r - (1 << j) + 1]);
  }
}
\`\`\``,
          desc: 'Idempotent range queries in O(1) after O(n log n) preprocess.',
        },
      },
      monotonic_stack: {
        python: {
          title: 'Monotonic Stack (Next Greater Element)',
          code: `\`\`\`python
def next_greater(nums):
    n = len(nums)
    result = [-1] * n
    stack = []  # stack of indices with decreasing values
    for i in range(n):
        while stack and nums[stack[-1]] < nums[i]:
            result[stack.pop()] = nums[i]
        stack.append(i)
    return result

# Usage:
print(next_greater([2, 1, 2, 4, 3]))  # [4, 2, 4, -1, -1]
\`\`\``,
          desc: 'Each element pushed/popped at most once. O(n) time, O(n) space.',
        },
        javascript: {
          title: 'Monotonic Stack (Next Greater Element)',
          code: `\`\`\`javascript
function nextGreater(nums) {
  const n = nums.length;
  const result = new Array(n).fill(-1);
  const stack = [];
  for (let i = 0; i < n; i++) {
    while (stack.length && nums[stack[stack.length - 1]] < nums[i]) {
      result[stack.pop()] = nums[i];
    }
    stack.push(i);
  }
  return result;
}
\`\`\``,
          desc: 'Monotonic decreasing stack. O(n).',
        },
      },
      monotonic_queue: {
        python: {
          title: 'Monotonic Deque (Sliding Window Maximum)',
          code: `\`\`\`python
from collections import deque

def sliding_window_max(nums, k):
    q = deque()  # indices, values in decreasing order
    out = []
    for i, x in enumerate(nums):
        while q and nums[q[-1]] <= x:
            q.pop()
        q.append(i)
        if q[0] <= i - k:
            q.popleft()
        if i >= k - 1:
            out.append(nums[q[0]])
    return out

# Usage:
print(sliding_window_max([1, 3, -1, -3, 5, 3, 6, 7], 3))  # [3, 3, 5, 5, 6, 7]
\`\`\``,
          desc: 'Deque of indices keeps window max at front. O(n) amortised.',
        },
        javascript: {
          title: 'Monotonic Deque (Sliding Window Maximum)',
          code: `\`\`\`javascript
function slidingWindowMax(nums, k) {
  const q = []; // array used as deque of indices
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    while (q.length && nums[q[q.length - 1]] <= nums[i]) q.pop();
    q.push(i);
    if (q[0] <= i - k) q.shift();
    if (i >= k - 1) out.push(nums[q[0]]);
  }
  return out;
}
\`\`\``,
          desc: 'Deque keeps window max at front. O(n) amortised. For very large n use linked list deque.',
        },
      },
      bloom_filter: {
        python: {
          title: 'Bloom Filter',
          code: `\`\`\`python
import hashlib

class BloomFilter:
    def __init__(self, size=1024, k=3):
        self.size = size
        self.k = k
        self.bits = bytearray((size + 7) // 8)
    def _hashes(self, item):
        b = str(item).encode()
        for i in range(self.k):
            h = int(hashlib.md5(b + bytes([i])).hexdigest(), 16) % self.size
            yield h
    def add(self, item):
        for h in self._hashes(item):
            self.bits[h // 8] |= (1 << (h % 8))
    def __contains__(self, item):
        return all((self.bits[h // 8] >> (h % 8)) & 1 for h in self._hashes(item))

# Usage:
bf = BloomFilter(1024, 3)
bf.add('apple'); bf.add('banana')
print('apple' in bf, 'cherry' in bf)  # True (maybe False for cherry)
\`\`\``,
          desc: 'Probabilistic set membership. False positives possible, never false negatives. Tune size and k for target FP rate.',
        },
        javascript: {
          title: 'Bloom Filter',
          code: `\`\`\`javascript
class BloomFilter {
  constructor(size = 1024, k = 3) {
    this.size = size; this.k = k;
    this.bits = new Uint8Array(Math.ceil(size / 8));
  }
  *_hashes(item) {
    const s = String(item);
    for (let i = 0; i < this.k; i++) {
      let h = 2166136261 ^ i;
      for (let j = 0; j < s.length; j++) {
        h ^= s.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
      yield ((h >>> 0) % this.size);
    }
  }
  add(item) { for (const h of this._hashes(item)) this.bits[h >> 3] |= 1 << (h & 7); }
  has(item) {
    for (const h of this._hashes(item)) {
      if (!(this.bits[h >> 3] & (1 << (h & 7)))) return false;
    }
    return true;
  }
}
\`\`\``,
          desc: 'FNV-1a variants for hashing. Probabilistic membership.',
        },
      },
      suffix_array: {
        python: {
          title: 'Suffix Array (simple O(n^2 log n))',
          code: `\`\`\`python
def suffix_array(s):
    n = len(s)
    return sorted(range(n), key=lambda i: s[i:])

# Usage:
print(suffix_array('banana'))  # [5, 3, 1, 0, 4, 2]
\`\`\``,
          desc: 'Simplest construction via sorting all suffixes. O(n^2 log n). For n > ~1e5 use DC3 or SA-IS.',
        },
        javascript: {
          title: 'Suffix Array (simple O(n^2 log n))',
          code: `\`\`\`javascript
function suffixArray(s) {
  return Array.from({ length: s.length }, (_, i) => i)
    .sort((a, b) => {
      const sa = s.slice(a), sb = s.slice(b);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
}
\`\`\``,
          desc: 'Naive sort. O(n^2 log n). For big inputs use a DC3/SA-IS variant.',
        },
      },
      skip_list: {
        python: {
          title: 'Skip List',
          code: `\`\`\`python
import random

class SkipNode:
    __slots__ = ('val', 'forward')
    def __init__(self, val, level):
        self.val = val
        self.forward = [None] * (level + 1)

class SkipList:
    def __init__(self, max_level=16, p=0.5):
        self.max_level = max_level
        self.p = p
        self.level = 0
        self.head = SkipNode(None, max_level)
    def _random_level(self):
        lvl = 0
        while random.random() < self.p and lvl < self.max_level: lvl += 1
        return lvl
    def insert(self, val):
        update = [self.head] * (self.max_level + 1)
        cur = self.head
        for i in range(self.level, -1, -1):
            while cur.forward[i] and cur.forward[i].val < val:
                cur = cur.forward[i]
            update[i] = cur
        lvl = self._random_level()
        if lvl > self.level: self.level = lvl
        node = SkipNode(val, lvl)
        for i in range(lvl + 1):
            node.forward[i] = update[i].forward[i]
            update[i].forward[i] = node
    def contains(self, val):
        cur = self.head
        for i in range(self.level, -1, -1):
            while cur.forward[i] and cur.forward[i].val < val:
                cur = cur.forward[i]
        cur = cur.forward[0]
        return cur is not None and cur.val == val

# Usage:
sl = SkipList()
for v in [3, 6, 7, 9, 12, 19]: sl.insert(v)
print(sl.contains(9), sl.contains(8))  # True False
\`\`\``,
          desc: 'Probabilistic balanced structure. Expected O(log n) insert/lookup with O(n) memory.',
        },
        javascript: {
          title: 'Skip List',
          code: `\`\`\`javascript
class SkipList {
  constructor(maxLevel = 16, p = 0.5) {
    this.maxLevel = maxLevel; this.p = p; this.level = 0;
    this.head = { val: null, forward: new Array(maxLevel + 1).fill(null) };
  }
  _randomLevel() {
    let lvl = 0;
    while (Math.random() < this.p && lvl < this.maxLevel) lvl++;
    return lvl;
  }
  insert(val) {
    const update = new Array(this.maxLevel + 1).fill(this.head);
    let cur = this.head;
    for (let i = this.level; i >= 0; i--) {
      while (cur.forward[i] && cur.forward[i].val < val) cur = cur.forward[i];
      update[i] = cur;
    }
    const lvl = this._randomLevel();
    if (lvl > this.level) this.level = lvl;
    const node = { val, forward: new Array(lvl + 1).fill(null) };
    for (let i = 0; i <= lvl; i++) { node.forward[i] = update[i].forward[i]; update[i].forward[i] = node; }
  }
  contains(val) {
    let cur = this.head;
    for (let i = this.level; i >= 0; i--) {
      while (cur.forward[i] && cur.forward[i].val < val) cur = cur.forward[i];
    }
    cur = cur.forward[0];
    return !!cur && cur.val === val;
  }
}
\`\`\``,
          desc: 'Probabilistic balanced structure. Expected O(log n) per op.',
        },
      },
      circular_buffer: {
        python: {
          title: 'Circular Buffer (Ring Buffer)',
          code: `\`\`\`python
class CircularBuffer:
    def __init__(self, capacity):
        self.buf = [None] * capacity
        self.cap = capacity
        self.head = self.tail = self.size = 0
    def push(self, item):
        self.buf[self.tail] = item
        if self.size == self.cap:
            self.head = (self.head + 1) % self.cap  # overwrite oldest
        else:
            self.size += 1
        self.tail = (self.tail + 1) % self.cap
    def pop(self):
        if self.size == 0: raise IndexError('empty')
        item = self.buf[self.head]
        self.buf[self.head] = None
        self.head = (self.head + 1) % self.cap
        self.size -= 1
        return item
    def __len__(self): return self.size

# Usage:
cb = CircularBuffer(3)
cb.push(1); cb.push(2); cb.push(3); cb.push(4)  # overwrites 1
print(cb.pop(), cb.pop(), cb.pop())  # 2 3 4
\`\`\``,
          desc: 'Fixed-size FIFO; overwrites oldest on overflow. O(1) per operation.',
        },
        javascript: {
          title: 'Circular Buffer (Ring Buffer)',
          code: `\`\`\`javascript
class CircularBuffer {
  constructor(capacity) {
    this.buf = new Array(capacity); this.cap = capacity;
    this.head = 0; this.tail = 0; this.size = 0;
  }
  push(item) {
    this.buf[this.tail] = item;
    if (this.size === this.cap) this.head = (this.head + 1) % this.cap;
    else this.size++;
    this.tail = (this.tail + 1) % this.cap;
  }
  pop() {
    if (this.size === 0) throw new Error('empty');
    const item = this.buf[this.head];
    this.buf[this.head] = undefined;
    this.head = (this.head + 1) % this.cap;
    this.size--;
    return item;
  }
  get length() { return this.size; }
}
\`\`\``,
          desc: 'Fixed-size FIFO with overwrite-on-full. O(1) per op.',
        },
      },
      disjoint_set_forest: {
        python: {
          title: 'Disjoint Set Forest (Union-Find)',
          code: `\`\`\`python
class DSU:
    def __init__(self, n):
        self.parent = list(range(n))
        self.rank = [0] * n
    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]  # path compression
            x = self.parent[x]
        return x
    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb: return False
        if self.rank[ra] < self.rank[rb]: ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]: self.rank[ra] += 1
        return True

# Usage:
dsu = DSU(5)
dsu.union(0, 1); dsu.union(2, 3)
print(dsu.find(0) == dsu.find(1))  # True
print(dsu.find(1) == dsu.find(3))  # False
\`\`\``,
          desc: 'Union by rank + path compression. Near O(1) per op (inverse Ackermann).',
        },
        javascript: {
          title: 'Disjoint Set Forest (Union-Find)',
          code: `\`\`\`javascript
class DSU {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    let ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
    return true;
  }
}
\`\`\``,
          desc: 'Union by rank + path compression. Near-constant per op.',
        },
      },

      // ─── BATCH 6: WEB / DEV UTILITIES ───
      parse_url: {
        python: {
          title: 'Parse URL',
          code: `\`\`\`python
from urllib.parse import urlparse, parse_qs

def parse_url(url):
    p = urlparse(url)
    return {
        'scheme': p.scheme,
        'host': p.hostname,
        'port': p.port,
        'path': p.path,
        'query': parse_qs(p.query),
        'fragment': p.fragment,
    }

# Usage:
print(parse_url('https://example.com:8080/path?x=1&y=2#frag'))
\`\`\``,
          desc: 'Stdlib urllib.parse is battle-tested. Prefer it over hand-rolled parsers.',
        },
        javascript: {
          title: 'Parse URL',
          code: `\`\`\`javascript
function parseUrl(href) {
  const u = new URL(href);
  const query = {};
  for (const [k, v] of u.searchParams) query[k] = v;
  return {
    scheme: u.protocol.replace(':', ''),
    host: u.hostname,
    port: u.port || null,
    path: u.pathname,
    query,
    fragment: u.hash.replace('#', ''),
  };
}
\`\`\``,
          desc: 'Built-in URL constructor handles encoding, IDN, and edge cases. Use it.',
        },
      },
      build_query_string: {
        python: {
          title: 'Build Query String',
          code: `\`\`\`python
from urllib.parse import urlencode

def build_query(params):
    return urlencode(params, doseq=True)

# Usage:
print(build_query({'q': 'hello world', 'tags': ['a', 'b']}))
# q=hello+world&tags=a&tags=b
\`\`\``,
          desc: 'urlencode handles percent-encoding and list flattening via doseq.',
        },
        javascript: {
          title: 'Build Query String',
          code: `\`\`\`javascript
function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const x of v) sp.append(k, String(x));
    else sp.append(k, String(v));
  }
  return sp.toString();
}
\`\`\``,
          desc: 'URLSearchParams percent-encodes correctly. Append for arrays.',
        },
      },
      escape_html: {
        python: {
          title: 'Escape HTML',
          code: `\`\`\`python
def escape_html(s):
    return (s
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&#39;'))

# Usage:
print(escape_html('<script>alert("xss")</script>'))
\`\`\``,
          desc: 'Order matters: & first so it does not double-escape. For full safety use markupsafe or html.escape.',
        },
        javascript: {
          title: 'Escape HTML',
          code: `\`\`\`javascript
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
\`\`\``,
          desc: 'Escape & first so subsequent entities are not double-escaped.',
        },
      },
      url_encode: {
        python: {
          title: 'URL Encode (Percent-Encode)',
          code: `\`\`\`python
from urllib.parse import quote

def url_encode(s, safe=''):
    return quote(s, safe=safe)

# Usage:
print(url_encode('hello world/foo?bar=baz'))
# hello%20world%2Ffoo%3Fbar%3Dbaz
\`\`\``,
          desc: 'quote percent-encodes everything except letters/digits and the chars in "safe".',
        },
        javascript: {
          title: 'URL Encode (Percent-Encode)',
          code: `\`\`\`javascript
function urlEncode(s) {
  return encodeURIComponent(s);
}
\`\`\``,
          desc: 'encodeURIComponent handles percent-encoding correctly for query fragments.',
        },
      },
      base64_encode: {
        python: {
          title: 'Base64 Encode / Decode',
          code: `\`\`\`python
import base64

def b64_encode(data):
    if isinstance(data, str): data = data.encode()
    return base64.b64encode(data).decode('ascii')

def b64_decode(s):
    return base64.b64decode(s)

# Usage:
print(b64_encode('Hello'))  # SGVsbG8=
print(b64_decode('SGVsbG8=').decode())  # Hello
\`\`\``,
          desc: 'stdlib base64 handles padding. Use urlsafe_b64encode for URL-safe variant.',
        },
        javascript: {
          title: 'Base64 Encode / Decode',
          code: `\`\`\`javascript
function b64Encode(input) {
  if (typeof input === 'string') {
    return typeof btoa !== 'undefined' ? btoa(unescape(encodeURIComponent(input))) : Buffer.from(input, 'utf8').toString('base64');
  }
  return Buffer.from(input).toString('base64');
}
function b64Decode(s) {
  return typeof atob !== 'undefined' ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, 'base64').toString('utf8');
}
\`\`\``,
          desc: 'Works in both browser (btoa/atob) and Node (Buffer). btoa needs unescape trick for non-ASCII.',
        },
      },
      md5_hash: {
        python: {
          title: 'MD5 Hash',
          code: `\`\`\`python
import hashlib

def md5(data):
    if isinstance(data, str): data = data.encode('utf-8')
    return hashlib.md5(data).hexdigest()

# Usage:
print(md5('hello'))  # 5d41402abc4b2a76b9719d911017c592
\`\`\``,
          desc: 'MD5 is NOT secure for passwords or signatures. Use only for non-cryptographic checksums.',
        },
        javascript: {
          title: 'MD5 Hash',
          code: `\`\`\`javascript
// Node: use crypto
const { createHash } = require('crypto');

function md5(data) {
  return createHash('md5').update(typeof data === 'string' ? data : Buffer.from(data)).digest('hex');
}

// Browser: use SubtleCrypto (note: MD5 is not in WebCrypto; use a well-tested library like spark-md5)
\`\`\``,
          desc: 'MD5 is broken cryptographically. Never use for auth. Node has it via crypto; browsers need a library.',
        },
      },
      sha256_hash: {
        python: {
          title: 'SHA-256 Hash',
          code: `\`\`\`python
import hashlib

def sha256(data):
    if isinstance(data, str): data = data.encode('utf-8')
    return hashlib.sha256(data).hexdigest()

# Usage:
print(sha256('hello'))
# 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
\`\`\``,
          desc: 'SHA-256 suitable for content hashing and integrity. For passwords use bcrypt/argon2/scrypt instead.',
        },
        javascript: {
          title: 'SHA-256 Hash',
          code: `\`\`\`javascript
// Browser
async function sha256(str) {
  const bytes = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Node (synchronous)
// const { createHash } = require('crypto');
// const hex = createHash('sha256').update(str).digest('hex');
\`\`\``,
          desc: 'Use WebCrypto in browser, crypto.createHash in Node. Never roll your own.',
        },
      },
      safe_compare: {
        python: {
          title: 'Constant-Time String Comparison',
          code: `\`\`\`python
import hmac

def safe_compare(a, b):
    if isinstance(a, str): a = a.encode()
    if isinstance(b, str): b = b.encode()
    return hmac.compare_digest(a, b)

# Usage:
print(safe_compare('secret', 'secret'))  # True
\`\`\``,
          desc: 'hmac.compare_digest runs in constant time regardless of where the first differing byte is. Use for tokens, HMACs, signatures.',
        },
        javascript: {
          title: 'Constant-Time String Comparison',
          code: `\`\`\`javascript
const { timingSafeEqual } = require('crypto');

function safeCompare(a, b) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
\`\`\``,
          desc: 'crypto.timingSafeEqual avoids timing-attack leaks when comparing secrets.',
        },
      },
      uuid_v4: {
        python: {
          title: 'UUID v4 (Random)',
          code: `\`\`\`python
import uuid

def uuid_v4():
    return str(uuid.uuid4())

# Usage:
print(uuid_v4())  # e.g. '550e8400-e29b-41d4-a716-446655440000'
\`\`\``,
          desc: 'Prefer the stdlib uuid module. Uses cryptographic randomness on modern platforms.',
        },
        javascript: {
          title: 'UUID v4 (Random)',
          code: `\`\`\`javascript
function uuidV4() {
  // Browser and modern Node (>= 14.17) have crypto.randomUUID
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;  // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80;  // variant 10
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return \`\${hex.slice(0,8)}-\${hex.slice(8,12)}-\${hex.slice(12,16)}-\${hex.slice(16,20)}-\${hex.slice(20)}\`;
}
\`\`\``,
          desc: 'Use crypto.randomUUID when available; otherwise construct from getRandomValues with correct version/variant bits.',
        },
      },
      validate_email: {
        python: {
          title: 'Validate Email',
          code: `\`\`\`python
import re

_EMAIL = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')

def is_valid_email(s):
    return bool(_EMAIL.match(s or ''))

# Usage:
print(is_valid_email('user@example.com'))   # True
print(is_valid_email('bad@@example'))        # False
\`\`\``,
          desc: 'Pragmatic regex. RFC 5321 allows edge cases this rejects — for strict validation use email-validator library.',
        },
        javascript: {
          title: 'Validate Email',
          code: `\`\`\`javascript
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$/;

function isValidEmail(s) {
  return EMAIL.test(s || '');
}
\`\`\``,
          desc: 'Pragmatic regex. For strict validation use an email-validator library or send a verification link.',
        },
      },
      validate_phone: {
        python: {
          title: 'Validate Phone Number (loose)',
          code: `\`\`\`python
import re

_PHONE = re.compile(r'^\\+?[0-9]{1,3}?[-.\\s]?\\(?[0-9]{1,4}\\)?[-.\\s]?[0-9]{1,4}[-.\\s]?[0-9]{1,9}$')

def is_valid_phone(s):
    digits = re.sub(r'[^0-9]', '', s or '')
    if len(digits) < 7 or len(digits) > 15: return False
    return bool(_PHONE.match(s))

# Usage:
print(is_valid_phone('+1 (555) 123-4567'))  # True
\`\`\``,
          desc: 'Loose international validation. For strict country-specific rules, use the phonenumbers library (E.164).',
        },
        javascript: {
          title: 'Validate Phone Number (loose)',
          code: `\`\`\`javascript
function isValidPhone(s) {
  if (!s) return false;
  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  return /^\\+?[0-9]{1,3}?[-.\\s]?\\(?[0-9]{1,4}\\)?[-.\\s]?[0-9]{1,4}[-.\\s]?[0-9]{1,9}$/.test(s);
}
\`\`\``,
          desc: 'Loose international pattern. For production use libphonenumber-js.',
        },
      },
      format_currency: {
        python: {
          title: 'Format Currency',
          code: `\`\`\`python
def format_currency(amount, currency='USD', locale='en_US'):
    # Minimal stdlib-only version; for rich i18n use babel.numbers.format_currency
    symbols = {'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'NOK': 'kr'}
    sym = symbols.get(currency, currency + ' ')
    sign = '-' if amount < 0 else ''
    amount = abs(amount)
    whole, frac = divmod(int(round(amount * 100)), 100)
    whole_str = f'{whole:,}'
    return f'{sign}{sym}{whole_str}.{frac:02d}'

# Usage:
print(format_currency(1234567.89))  # $1,234,567.89
print(format_currency(-99.5, 'EUR'))  # -€99.50
\`\`\``,
          desc: 'Rounds to 2 decimals, inserts thousands separators. For i18n correctness use babel.numbers.',
        },
        javascript: {
          title: 'Format Currency',
          code: `\`\`\`javascript
function formatCurrency(amount, currency = 'USD', locale = 'en-US') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

// Usage:
// formatCurrency(1234567.89)       => $1,234,567.89
// formatCurrency(99.5, 'EUR', 'de-DE') => 99,50 €
\`\`\``,
          desc: 'Built-in Intl.NumberFormat handles locale-specific symbol, separators, and decimals.',
        },
      },
      format_bytes: {
        python: {
          title: 'Format Bytes (Human-Readable)',
          code: `\`\`\`python
def format_bytes(n):
    units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
    i, n = 0, float(n)
    while n >= 1024 and i < len(units) - 1:
        n /= 1024; i += 1
    return f'{n:.2f} {units[i]}' if i > 0 else f'{int(n)} {units[i]}'

# Usage:
print(format_bytes(1536))        # 1.50 KB
print(format_bytes(1_500_000))   # 1.43 MB
\`\`\``,
          desc: 'Binary (1024-based). For SI (1000-based) swap to [B, kB, MB, ...] and divide by 1000.',
        },
        javascript: {
          title: 'Format Bytes (Human-Readable)',
          code: `\`\`\`javascript
function formatBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return i === 0 ? \`\${n | 0} \${units[i]}\` : \`\${n.toFixed(2)} \${units[i]}\`;
}
\`\`\``,
          desc: 'Binary formatting (1024-based). Swap to decimal for SI prefixes.',
        },
      },
      mask_credit_card: {
        python: {
          title: 'Mask Credit Card Number',
          code: `\`\`\`python
import re

def mask_card(num):
    digits = re.sub(r'[^0-9]', '', num or '')
    if len(digits) < 4: return '*' * len(digits)
    return '*' * (len(digits) - 4) + digits[-4:]

# Usage:
print(mask_card('4111 1111 1111 1234'))  # ************1234
\`\`\``,
          desc: 'Shows only the last 4 digits; strips spaces and dashes. Never log full card numbers.',
        },
        javascript: {
          title: 'Mask Credit Card Number',
          code: `\`\`\`javascript
function maskCard(num) {
  const digits = String(num || '').replace(/[^0-9]/g, '');
  if (digits.length < 4) return '*'.repeat(digits.length);
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}
\`\`\``,
          desc: 'Keeps only the last 4 digits visible. PCI-safe for display.',
        },
      },
      parse_cookies: {
        python: {
          title: 'Parse Cookie Header',
          code: `\`\`\`python
def parse_cookies(header):
    out = {}
    for pair in (header or '').split(';'):
        pair = pair.strip()
        if not pair: continue
        if '=' in pair:
            k, v = pair.split('=', 1)
            out[k.strip()] = v.strip()
        else:
            out[pair] = ''
    return out

# Usage:
print(parse_cookies('session=abc123; theme=dark; flag'))
# {'session': 'abc123', 'theme': 'dark', 'flag': ''}
\`\`\``,
          desc: 'Splits on ";" then "=". For server code prefer http.cookies.SimpleCookie which handles RFC 6265 edge cases.',
        },
        javascript: {
          title: 'Parse Cookie Header',
          code: `\`\`\`javascript
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) out[trimmed] = '';
    else out[trimmed.slice(0, eq).trim()] = decodeURIComponent(trimmed.slice(eq + 1).trim());
  }
  return out;
}
\`\`\``,
          desc: 'Handles cookies with and without values; decodes percent-encoded values.',
        },
      },

      // ─── BATCH 7: DATE/TIME & I/O ───
      format_date: {
        python: {
          title: 'Format Date',
          code: `\`\`\`python
from datetime import datetime

def format_date(dt=None, fmt='%Y-%m-%d %H:%M:%S'):
    return (dt or datetime.now()).strftime(fmt)

# Usage:
print(format_date())                           # 2025-04-21 10:30:45
print(format_date(fmt='%Y-%m-%d'))             # 2025-04-21
print(format_date(fmt='%B %d, %Y'))            # April 21, 2025
\`\`\``,
          desc: 'strftime format codes: %Y year, %m month, %d day, %H hour, %M min, %S sec, %B full month, %A weekday.',
        },
        javascript: {
          title: 'Format Date',
          code: `\`\`\`javascript
function formatDate(date = new Date(), locale = 'en-US', options = { year: 'numeric', month: '2-digit', day: '2-digit' }) {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

// Usage:
// formatDate()  => '04/21/2025'
// formatDate(new Date(), 'en-GB')  => '21/04/2025'
// formatDate(new Date(), 'en-US', { dateStyle: 'full', timeStyle: 'short' })
\`\`\``,
          desc: 'Intl.DateTimeFormat gives locale-aware output. For ISO format use Date.toISOString().',
        },
      },
      parse_iso8601: {
        python: {
          title: 'Parse ISO-8601 Date',
          code: `\`\`\`python
from datetime import datetime

def parse_iso8601(s):
    # Python 3.11+ handles 'Z' natively; earlier versions need replacement
    return datetime.fromisoformat(s.replace('Z', '+00:00'))

# Usage:
print(parse_iso8601('2025-04-21T10:30:00Z'))
print(parse_iso8601('2025-04-21T10:30:00+02:00'))
\`\`\``,
          desc: 'fromisoformat handles most ISO-8601 variants. For relaxed parsing use dateutil.parser.parse.',
        },
        javascript: {
          title: 'Parse ISO-8601 Date',
          code: `\`\`\`javascript
function parseIso8601(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new Error('Invalid ISO-8601: ' + s);
  return d;
}
\`\`\``,
          desc: 'Native Date parser handles ISO-8601. Throws on invalid input.',
        },
      },
      date_diff_days: {
        python: {
          title: 'Days Between Two Dates',
          code: `\`\`\`python
from datetime import date, datetime

def days_between(a, b):
    if isinstance(a, datetime): a = a.date()
    if isinstance(b, datetime): b = b.date()
    return (b - a).days

# Usage:
print(days_between(date(2025, 1, 1), date(2025, 4, 21)))  # 110
\`\`\``,
          desc: 'Subtract dates to get a timedelta; .days ignores time component. Negative if b < a.',
        },
        javascript: {
          title: 'Days Between Two Dates',
          code: `\`\`\`javascript
function daysBetween(a, b) {
  const MS_PER_DAY = 86400000;
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / MS_PER_DAY);
}
\`\`\``,
          desc: 'Use UTC to avoid DST artefacts. Returns negative when b < a.',
        },
      },
      is_leap_year: {
        python: {
          title: 'Leap Year Check',
          code: `\`\`\`python
def is_leap_year(year):
    return (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)

# Usage:
print(is_leap_year(2024))  # True
print(is_leap_year(1900))  # False
print(is_leap_year(2000))  # True
\`\`\``,
          desc: 'Gregorian rule: divisible by 4, except centuries not divisible by 400.',
        },
        javascript: {
          title: 'Leap Year Check',
          code: `\`\`\`javascript
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}
\`\`\``,
          desc: 'Gregorian rule.',
        },
      },
      day_of_week: {
        python: {
          title: 'Day of Week (Zeller-style)',
          code: `\`\`\`python
from datetime import date

def day_of_week(year, month, day):
    names = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
    return names[date(year, month, day).weekday()]

# Usage:
print(day_of_week(2025, 4, 21))  # Monday
\`\`\``,
          desc: 'date.weekday() returns 0=Monday..6=Sunday. Use isoweekday() for 1..7 (ISO).',
        },
        javascript: {
          title: 'Day of Week',
          code: `\`\`\`javascript
function dayOfWeek(year, month, day) {
  const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  return names[new Date(year, month - 1, day).getDay()];
}
\`\`\``,
          desc: 'Date.getDay() returns 0=Sunday..6=Saturday. Months are 0-based in JS Date.',
        },
      },
      format_duration: {
        python: {
          title: 'Format Duration (seconds → human-readable)',
          code: `\`\`\`python
def format_duration(seconds):
    seconds = int(seconds)
    if seconds < 60: return f'{seconds}s'
    minutes, s = divmod(seconds, 60)
    if minutes < 60: return f'{minutes}m {s:02d}s'
    hours, m = divmod(minutes, 60)
    if hours < 24: return f'{hours}h {m:02d}m {s:02d}s'
    days, h = divmod(hours, 24)
    return f'{days}d {h:02d}h {m:02d}m'

# Usage:
print(format_duration(3665))    # 1h 01m 05s
print(format_duration(90061))   # 1d 01h 01m
\`\`\``,
          desc: 'Compact H:M:S formatting. Swap to ISO-8601 PnDTnHnMnS if needed.',
        },
        javascript: {
          title: 'Format Duration (seconds → human-readable)',
          code: `\`\`\`javascript
function formatDuration(seconds) {
  seconds = Math.floor(seconds);
  if (seconds < 60) return \`\${seconds}s\`;
  const s = seconds % 60, mTot = (seconds / 60) | 0;
  if (mTot < 60) return \`\${mTot}m \${String(s).padStart(2, '0')}s\`;
  const m = mTot % 60, hTot = (mTot / 60) | 0;
  if (hTot < 24) return \`\${hTot}h \${String(m).padStart(2, '0')}m \${String(s).padStart(2, '0')}s\`;
  const h = hTot % 24, d = (hTot / 24) | 0;
  return \`\${d}d \${String(h).padStart(2, '0')}h \${String(m).padStart(2, '0')}m\`;
}
\`\`\``,
          desc: 'Compact H:M:S formatting.',
        },
      },
      read_csv: {
        python: {
          title: 'Read CSV',
          code: `\`\`\`python
import csv

def read_csv(path, has_header=True):
    with open(path, newline='', encoding='utf-8') as f:
        if has_header:
            return list(csv.DictReader(f))
        return list(csv.reader(f))

# Usage:
# for row in read_csv('data.csv'):
#     print(row['name'], row['age'])
\`\`\``,
          desc: 'stdlib csv handles quoted fields, embedded newlines, and delimiter edge cases. Use DictReader when you have a header row.',
        },
        javascript: {
          title: 'Read CSV',
          code: `\`\`\`javascript
const fs = require('fs');

function readCsv(path, hasHeader = true) {
  const text = fs.readFileSync(path, 'utf8');
  const rows = parseCsv(text);
  if (!hasHeader) return rows;
  const [header, ...rest] = rows;
  return rest.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function parseCsv(text) {
  const rows = [[]];
  let field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { rows[rows.length - 1].push(field); field = ''; }
      else if (c === '\\n') { rows[rows.length - 1].push(field); field = ''; rows.push([]); }
      else if (c === '\\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || rows[rows.length - 1].length) rows[rows.length - 1].push(field);
  if (rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}
\`\`\``,
          desc: 'Handles quoted fields, escaped quotes, and embedded newlines. For production prefer papaparse or csv-parse.',
        },
      },
      write_csv: {
        python: {
          title: 'Write CSV',
          code: `\`\`\`python
import csv

def write_csv(path, rows, header=None):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        if header:
            writer = csv.DictWriter(f, fieldnames=header)
            writer.writeheader()
            writer.writerows(rows)
        else:
            csv.writer(f).writerows(rows)

# Usage:
# write_csv('out.csv', [{'name': 'Ada', 'age': 36}], header=['name', 'age'])
\`\`\``,
          desc: 'Use newline="" on open to avoid double-newlines on Windows. DictWriter keeps columns consistent.',
        },
        javascript: {
          title: 'Write CSV',
          code: `\`\`\`javascript
const fs = require('fs');

function writeCsv(path, rows, header) {
  const esc = v => {
    const s = String(v ?? '');
    return /[",\\n\\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [];
  if (header) lines.push(header.map(esc).join(','));
  for (const r of rows) {
    const values = header ? header.map(k => r[k]) : r;
    lines.push(values.map(esc).join(','));
  }
  fs.writeFileSync(path, lines.join('\\n'), 'utf8');
}
\`\`\``,
          desc: 'Quotes only when needed; doubles embedded quotes. Matches RFC 4180 expectations.',
        },
      },
      walk_directory: {
        python: {
          title: 'Walk Directory Recursively',
          code: `\`\`\`python
import os

def walk(root, filter_fn=None):
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            path = os.path.join(dirpath, f)
            if filter_fn is None or filter_fn(path):
                yield path

# Usage:
# for p in walk('.', lambda p: p.endswith('.py')):
#     print(p)
\`\`\``,
          desc: 'os.walk is a generator — use it for large trees. pathlib.Path.rglob is a modern alternative.',
        },
        javascript: {
          title: 'Walk Directory Recursively',
          code: `\`\`\`javascript
const fs = require('fs');
const path = require('path');

function* walk(root, filterFn) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) yield* walk(full, filterFn);
    else if (entry.isFile()) {
      if (!filterFn || filterFn(full)) yield full;
    }
  }
}

// Usage:
// for (const p of walk('.', p => p.endsWith('.js'))) console.log(p);
\`\`\``,
          desc: 'Generator yields lazily — memory-safe for huge trees. Uses withFileTypes to avoid extra stat calls.',
        },
      },
      stream_file_lines: {
        python: {
          title: 'Stream File Line-by-Line',
          code: `\`\`\`python
def stream_lines(path, encoding='utf-8'):
    with open(path, 'r', encoding=encoding) as f:
        for line in f:
            yield line.rstrip('\\n')

# Usage:
# for line in stream_lines('big.log'):
#     if 'ERROR' in line: print(line)
\`\`\``,
          desc: 'Iterating the file object reads one buffered line at a time — O(1) memory regardless of file size.',
        },
        javascript: {
          title: 'Stream File Line-by-Line',
          code: `\`\`\`javascript
const fs = require('fs');
const readline = require('readline');

async function streamLines(path) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines;
}

// Usage:
// for await (const line of readline.createInterface({ input: fs.createReadStream('big.log') })) {
//   if (line.includes('ERROR')) console.log(line);
// }
\`\`\``,
          desc: 'readline with crlfDelay: Infinity handles CRLF correctly on Windows. Prefer the async iterator for memory safety.',
        },
      },

      // ─── BATCH 8: ASYNC PATTERNS ───
      sleep: {
        python: {
          title: 'Sleep (async delay)',
          code: `\`\`\`python
import asyncio, time

async def sleep_async(seconds):
    await asyncio.sleep(seconds)

def sleep_sync(seconds):
    time.sleep(seconds)

# Usage:
# await sleep_async(1.5)
\`\`\``,
          desc: 'asyncio.sleep yields to the event loop; time.sleep blocks the thread. Use the right one.',
        },
        javascript: {
          title: 'Sleep (async delay)',
          code: `\`\`\`javascript
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Usage:
// await sleep(1500);
\`\`\``,
          desc: 'Classic one-liner. Works in both browser and Node. Resolves after ms milliseconds.',
        },
      },
      promise_pool: {
        python: {
          title: 'Async Concurrency Pool',
          code: `\`\`\`python
import asyncio

async def pool(tasks, limit):
    semaphore = asyncio.Semaphore(limit)
    async def run(t):
        async with semaphore:
            return await t()
    return await asyncio.gather(*(run(t) for t in tasks))

# Usage: tasks is a list of zero-arg async callables
# results = await pool([lambda: fetch(u) for u in urls], limit=5)
\`\`\``,
          desc: 'Semaphore caps concurrency. Use asyncio.as_completed for streaming results instead of gather.',
        },
        javascript: {
          title: 'Promise Concurrency Pool',
          code: `\`\`\`javascript
async function promisePool(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const cur = idx++;
      results[cur] = await tasks[cur]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// Usage: tasks is array of zero-arg async functions
// const results = await promisePool(urls.map(u => () => fetch(u)), 5);
\`\`\``,
          desc: 'N workers pull from a shared index — simple and efficient. O(1) extra memory beyond the results array.',
        },
      },
      race_timeout: {
        python: {
          title: 'Async with Timeout',
          code: `\`\`\`python
import asyncio

async def with_timeout(coro, seconds):
    try:
        return await asyncio.wait_for(coro, timeout=seconds)
    except asyncio.TimeoutError:
        raise TimeoutError(f'Operation timed out after {seconds}s')

# Usage:
# result = await with_timeout(slow_fetch(), seconds=5)
\`\`\``,
          desc: 'asyncio.wait_for cancels the wrapped coroutine on timeout. Catches TimeoutError to provide a friendlier message.',
        },
        javascript: {
          title: 'Promise with Timeout',
          code: `\`\`\`javascript
function withTimeout(promise, ms, message = 'Timed out') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message + ' (' + ms + 'ms)')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Usage:
// const result = await withTimeout(fetch(url), 5000);
\`\`\``,
          desc: 'Race the caller promise against a timer. Clears the timer to avoid leaks. Note: the original promise keeps running.',
        },
      },
      async_queue: {
        python: {
          title: 'Async Task Queue (Worker Pool)',
          code: `\`\`\`python
import asyncio

class AsyncQueue:
    def __init__(self, workers=4):
        self.q = asyncio.Queue()
        self.workers = [asyncio.create_task(self._worker()) for _ in range(workers)]

    async def _worker(self):
        while True:
            task = await self.q.get()
            if task is None:
                self.q.task_done(); break
            try: await task()
            finally: self.q.task_done()

    async def enqueue(self, task):
        await self.q.put(task)

    async def close(self):
        for _ in self.workers: await self.q.put(None)
        await asyncio.gather(*self.workers)

# Usage:
# q = AsyncQueue(4)
# await q.enqueue(lambda: fetch_and_save(url))
# await q.close()
\`\`\``,
          desc: 'Fan-out task dispatcher. Sentinel None stops workers. Use asyncio.Queue.join() to wait for drain before closing.',
        },
        javascript: {
          title: 'Async Task Queue (Worker Pool)',
          code: `\`\`\`javascript
class AsyncQueue {
  constructor(workers = 4) {
    this.queue = [];
    this.active = 0;
    this.limit = workers;
    this.resolvers = [];
  }
  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._drain();
    });
  }
  async _drain() {
    while (this.active < this.limit && this.queue.length) {
      const { task, resolve, reject } = this.queue.shift();
      this.active++;
      Promise.resolve().then(() => task()).then(resolve, reject).finally(() => {
        this.active--;
        this._drain();
      });
    }
  }
}

// Usage:
// const q = new AsyncQueue(4);
// await q.enqueue(() => fetch(url));
\`\`\``,
          desc: 'Drains up to `limit` tasks concurrently. Each enqueue returns a promise that resolves with the task result.',
        },
      },
      event_emitter: {
        python: {
          title: 'Event Emitter (Pub/Sub)',
          code: `\`\`\`python
from collections import defaultdict

class EventEmitter:
    def __init__(self):
        self.listeners = defaultdict(list)
    def on(self, event, handler):
        self.listeners[event].append(handler)
        return lambda: self.off(event, handler)  # returns unsubscribe
    def off(self, event, handler):
        if handler in self.listeners[event]:
            self.listeners[event].remove(handler)
    def emit(self, event, *args, **kwargs):
        for h in list(self.listeners[event]):
            h(*args, **kwargs)
    def once(self, event, handler):
        def wrapper(*args, **kwargs):
            self.off(event, wrapper); handler(*args, **kwargs)
        self.on(event, wrapper)

# Usage:
# bus = EventEmitter(); bus.on('ping', lambda: print('pong')); bus.emit('ping')
\`\`\``,
          desc: 'Tiny in-process pub/sub. For inter-process messaging use a real broker (Redis, RabbitMQ).',
        },
        javascript: {
          title: 'Event Emitter (Pub/Sub)',
          code: `\`\`\`javascript
class EventEmitter {
  constructor() { this.listeners = new Map(); }
  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }
  off(event, handler) { this.listeners.get(event)?.delete(handler); }
  emit(event, ...args) {
    for (const h of [...(this.listeners.get(event) ?? [])]) h(...args);
  }
  once(event, handler) {
    const wrap = (...a) => { this.off(event, wrap); handler(...a); };
    this.on(event, wrap);
  }
}
\`\`\``,
          desc: 'Set-backed handlers allow fast add/remove. `on` returns an unsubscribe function.',
        },
      },
      sliding_window: {
        python: {
          title: 'Sliding Window Iterator',
          code: `\`\`\`python
from collections import deque

def sliding_window(iterable, size):
    it = iter(iterable)
    window = deque(maxlen=size)
    for _ in range(size):
        try: window.append(next(it))
        except StopIteration: return
    yield tuple(window)
    for x in it:
        window.append(x)
        yield tuple(window)

# Usage:
print(list(sliding_window([1, 2, 3, 4, 5], 3)))  # [(1,2,3),(2,3,4),(3,4,5)]
\`\`\``,
          desc: 'Generator yields overlapping windows. Uses bounded deque for O(1) updates.',
        },
        javascript: {
          title: 'Sliding Window Iterator',
          code: `\`\`\`javascript
function* slidingWindow(iterable, size) {
  const window = [];
  for (const x of iterable) {
    window.push(x);
    if (window.length < size) continue;
    if (window.length > size) window.shift();
    yield [...window];
  }
}

// Usage:
// [...slidingWindow([1,2,3,4,5], 3)]  => [[1,2,3],[2,3,4],[3,4,5]]
\`\`\``,
          desc: 'Generator yields overlapping windows lazily.',
        },
      },
      pairwise: {
        python: {
          title: 'Pairwise Iterator',
          code: `\`\`\`python
from itertools import tee

def pairwise(iterable):
    a, b = tee(iterable)
    next(b, None)
    return zip(a, b)

# Usage:
print(list(pairwise([1, 2, 3, 4])))  # [(1,2),(2,3),(3,4)]
# Python 3.10+: itertools.pairwise is built-in
\`\`\``,
          desc: 'Classic tee trick. Python 3.10+ has itertools.pairwise built in.',
        },
        javascript: {
          title: 'Pairwise Iterator',
          code: `\`\`\`javascript
function* pairwise(iterable) {
  let prev, first = true;
  for (const x of iterable) {
    if (!first) yield [prev, x];
    prev = x; first = false;
  }
}

// Usage:
// [...pairwise([1,2,3,4])]  => [[1,2],[2,3],[3,4]]
\`\`\``,
          desc: 'Generator yields consecutive pairs.',
        },
      },
      generator_chain: {
        python: {
          title: 'Chain Iterators',
          code: `\`\`\`python
from itertools import chain

# Use stdlib itertools.chain for flat concatenation
# For nested iterables use chain.from_iterable

# Usage:
print(list(chain([1, 2], [3, 4], [5])))          # [1,2,3,4,5]
print(list(chain.from_iterable([[1,2],[3,4]])))  # [1,2,3,4]
\`\`\``,
          desc: 'Prefer itertools.chain over manual concat; it is lazy and memory-efficient.',
        },
        javascript: {
          title: 'Chain Iterators',
          code: `\`\`\`javascript
function* chain(...iterables) {
  for (const it of iterables) yield* it;
}

// Usage:
// [...chain([1,2], [3,4], [5])]  => [1,2,3,4,5]
\`\`\``,
          desc: 'Uses yield* to delegate to each inner iterable. O(1) extra memory.',
        },
      },
      batch_async: {
        python: {
          title: 'Batch Async Requests',
          code: `\`\`\`python
import asyncio

async def batch_async(items, batch_size, handler):
    results = []
    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        results.extend(await asyncio.gather(*(handler(x) for x in batch)))
    return results

# Usage:
# results = await batch_async(urls, batch_size=10, handler=fetch)
\`\`\``,
          desc: 'Processes items in concurrent batches. Cap concurrency via batch_size to respect upstream rate limits.',
        },
        javascript: {
          title: 'Batch Async Requests',
          code: `\`\`\`javascript
async function batchAsync(items, batchSize, handler) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    results.push(...await Promise.all(batch.map(handler)));
  }
  return results;
}

// Usage:
// const results = await batchAsync(urls, 10, fetch);
\`\`\``,
          desc: 'Simple wave-based batching. For continuous concurrency use a promise pool (see that template).',
        },
      },
      cancellable_fetch: {
        python: {
          title: 'Cancellable HTTP Request',
          code: `\`\`\`python
import asyncio, aiohttp

async def cancellable_fetch(url, timeout=10):
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                return await r.text()
        except asyncio.TimeoutError:
            raise TimeoutError(f'Request to {url} timed out after {timeout}s')

# Usage:
# text = await cancellable_fetch('https://example.com', timeout=5)
\`\`\``,
          desc: 'aiohttp ClientTimeout cancels the request cleanly on timeout. For full cancel semantics wrap in asyncio.Task and call task.cancel().',
        },
        javascript: {
          title: 'Cancellable fetch (AbortController)',
          code: `\`\`\`javascript
async function cancellableFetch(url, { timeout = 10000, ...opts } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out after ' + timeout + 'ms');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
\`\`\``,
          desc: 'Standard AbortController pattern. Timer aborts the fetch; AbortError is rethrown as a clearer TimeoutError.',
        },
      },

      // ─── BATCH 9: STATS & ML BASICS ───
      percentile: {
        python: {
          title: 'Percentile (Linear Interpolation)',
          code: `\`\`\`python
def percentile(data, p):
    if not data: raise ValueError('empty data')
    s = sorted(data)
    k = (len(s) - 1) * (p / 100)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)

# Usage:
print(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90))  # 9.1
# For production use statistics.quantiles or numpy.percentile
\`\`\``,
          desc: 'Linear interpolation between the two neighbour values (type-7 / numpy default). O(n log n) due to sort.',
        },
        javascript: {
          title: 'Percentile (Linear Interpolation)',
          code: `\`\`\`javascript
function percentile(data, p) {
  if (!data.length) throw new Error('empty data');
  const s = [...data].sort((a, b) => a - b);
  const k = (s.length - 1) * (p / 100);
  const f = Math.floor(k), c = Math.min(f + 1, s.length - 1);
  return s[f] + (s[c] - s[f]) * (k - f);
}
\`\`\``,
          desc: 'Type-7 interpolation. O(n log n).',
        },
      },
      moving_average: {
        python: {
          title: 'Simple Moving Average',
          code: `\`\`\`python
from collections import deque

def moving_average(data, window):
    if window <= 0: raise ValueError('window must be positive')
    out, total, buf = [], 0.0, deque(maxlen=window)
    for x in data:
        if len(buf) == window: total -= buf[0]
        buf.append(x); total += x
        if len(buf) == window: out.append(total / window)
    return out

# Usage:
print(moving_average([1, 2, 3, 4, 5, 6], 3))  # [2.0, 3.0, 4.0, 5.0]
\`\`\``,
          desc: 'O(n) single-pass with deque; avoids recomputing the window sum each step.',
        },
        javascript: {
          title: 'Simple Moving Average',
          code: `\`\`\`javascript
function movingAverage(data, window) {
  if (window <= 0) throw new Error('window must be positive');
  const out = [];
  let total = 0;
  for (let i = 0; i < data.length; i++) {
    total += data[i];
    if (i >= window) total -= data[i - window];
    if (i >= window - 1) out.push(total / window);
  }
  return out;
}
\`\`\``,
          desc: 'Rolling-sum approach. O(n).',
        },
      },
      ema: {
        python: {
          title: 'Exponential Moving Average',
          code: `\`\`\`python
def ema(data, alpha):
    if not (0 < alpha <= 1): raise ValueError('alpha must be in (0, 1]')
    out = []
    prev = None
    for x in data:
        prev = x if prev is None else alpha * x + (1 - alpha) * prev
        out.append(prev)
    return out

# Usage:
# alpha = 2 / (N + 1) for N-period equivalent
print(ema([1, 2, 3, 4, 5], alpha=0.5))
\`\`\``,
          desc: 'Classic recursive EMA. For N-period equivalent pick alpha = 2/(N+1).',
        },
        javascript: {
          title: 'Exponential Moving Average',
          code: `\`\`\`javascript
function ema(data, alpha) {
  if (!(alpha > 0 && alpha <= 1)) throw new Error('alpha must be in (0, 1]');
  const out = [];
  let prev = null;
  for (const x of data) {
    prev = prev === null ? x : alpha * x + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}
\`\`\``,
          desc: 'Recursive EMA. alpha = 2/(N+1) for N-period equivalent.',
        },
      },
      zscore: {
        python: {
          title: 'Z-Score (Standard Score)',
          code: `\`\`\`python
import math

def zscore(data):
    n = len(data)
    if n < 2: raise ValueError('need at least 2 values')
    mu = sum(data) / n
    var = sum((x - mu) ** 2 for x in data) / (n - 1)
    sd = math.sqrt(var)
    if sd == 0: return [0.0] * n
    return [(x - mu) / sd for x in data]

# Usage:
print(zscore([1, 2, 3, 4, 5]))
\`\`\``,
          desc: 'Uses sample standard deviation (n-1). Returns zeros when variance is zero.',
        },
        javascript: {
          title: 'Z-Score (Standard Score)',
          code: `\`\`\`javascript
function zscore(data) {
  const n = data.length;
  if (n < 2) throw new Error('need at least 2 values');
  const mu = data.reduce((a, b) => a + b, 0) / n;
  const variance = data.reduce((a, x) => a + (x - mu) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return new Array(n).fill(0);
  return data.map(x => (x - mu) / sd);
}
\`\`\``,
          desc: 'Sample standard deviation.',
        },
      },
      correlation: {
        python: {
          title: 'Pearson Correlation Coefficient',
          code: `\`\`\`python
import math

def correlation(x, y):
    n = len(x)
    if n != len(y) or n < 2: raise ValueError('bad lengths')
    mx = sum(x) / n
    my = sum(y) / n
    num = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
    dx = math.sqrt(sum((xi - mx) ** 2 for xi in x))
    dy = math.sqrt(sum((yi - my) ** 2 for yi in y))
    if dx == 0 or dy == 0: return 0.0
    return num / (dx * dy)

# Usage:
print(correlation([1,2,3,4,5], [2,4,6,8,10]))  # 1.0
\`\`\``,
          desc: 'Pearson r in [-1, 1]. Returns 0 on zero variance. For rank-based use Spearman.',
        },
        javascript: {
          title: 'Pearson Correlation Coefficient',
          code: `\`\`\`javascript
function correlation(x, y) {
  const n = x.length;
  if (n !== y.length || n < 2) throw new Error('bad lengths');
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const ax = x[i] - mx, ay = y[i] - my;
    num += ax * ay; dx += ax * ax; dy += ay * ay;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
\`\`\``,
          desc: 'Pearson r in [-1, 1].',
        },
      },
      covariance: {
        python: {
          title: 'Covariance',
          code: `\`\`\`python
def covariance(x, y, sample=True):
    n = len(x)
    if n != len(y) or n < 2: raise ValueError('bad lengths')
    mx = sum(x) / n
    my = sum(y) / n
    s = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
    return s / (n - 1) if sample else s / n

# Usage:
print(covariance([1,2,3,4,5], [2,4,6,8,10]))  # 5.0
\`\`\``,
          desc: 'Sample covariance (n-1) by default. Pass sample=False for population.',
        },
        javascript: {
          title: 'Covariance',
          code: `\`\`\`javascript
function covariance(x, y, sample = true) {
  const n = x.length;
  if (n !== y.length || n < 2) throw new Error('bad lengths');
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return sample ? s / (n - 1) : s / n;
}
\`\`\``,
          desc: 'Sample cov (n-1) by default.',
        },
      },
      linear_regression: {
        python: {
          title: 'Linear Regression (OLS, single feature)',
          code: `\`\`\`python
def linear_regression(x, y):
    n = len(x)
    if n != len(y) or n < 2: raise ValueError('bad lengths')
    mx = sum(x) / n
    my = sum(y) / n
    num = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y))
    den = sum((xi - mx) ** 2 for xi in x)
    slope = num / den if den != 0 else 0.0
    intercept = my - slope * mx
    return slope, intercept

# Usage:
slope, intercept = linear_regression([1,2,3,4,5], [2,4,6,8,10])
print(slope, intercept)  # 2.0 0.0
\`\`\``,
          desc: 'Closed-form OLS for y = slope * x + intercept. For multi-feature use statsmodels or sklearn.',
        },
        javascript: {
          title: 'Linear Regression (OLS, single feature)',
          code: `\`\`\`javascript
function linearRegression(x, y) {
  const n = x.length;
  if (n !== y.length || n < 2) throw new Error('bad lengths');
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}
\`\`\``,
          desc: 'Closed-form OLS.',
        },
      },
      k_means: {
        python: {
          title: 'K-Means Clustering (Lloyd)',
          code: `\`\`\`python
import random
import math

def k_means(points, k, max_iter=100, tol=1e-4):
    centroids = random.sample(list(points), k)
    for _ in range(max_iter):
        clusters = [[] for _ in range(k)]
        for p in points:
            dists = [sum((pi - ci) ** 2 for pi, ci in zip(p, c)) for c in centroids]
            clusters[dists.index(min(dists))].append(p)
        new_centroids = [
            tuple(sum(x) / len(cluster) for x in zip(*cluster)) if cluster else centroids[i]
            for i, cluster in enumerate(clusters)
        ]
        shift = max(math.sqrt(sum((a - b) ** 2 for a, b in zip(o, n))) for o, n in zip(centroids, new_centroids))
        centroids = new_centroids
        if shift < tol: break
    return centroids, clusters

# Usage:
pts = [(1,1),(1,2),(10,10),(10,11),(20,20)]
centroids, clusters = k_means(pts, k=3)
\`\`\``,
          desc: `Lloyd's algorithm. Converges to a local optimum; run multiple times with different seeds for better results.`,
        },
        javascript: {
          title: 'K-Means Clustering (Lloyd)',
          code: `\`\`\`javascript
function kMeans(points, k, maxIter = 100, tol = 1e-4) {
  const indices = [...points.keys()].sort(() => Math.random() - 0.5).slice(0, k);
  let centroids = indices.map(i => [...points[i]]);
  for (let iter = 0; iter < maxIter; iter++) {
    const clusters = Array.from({ length: k }, () => []);
    for (const p of points) {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < k; i++) {
        let d = 0;
        for (let j = 0; j < p.length; j++) d += (p[j] - centroids[i][j]) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      clusters[best].push(p);
    }
    const next = clusters.map((c, i) => c.length ? c[0].map((_, j) => c.reduce((s, p) => s + p[j], 0) / c.length) : centroids[i]);
    const shift = Math.max(...centroids.map((c, i) => Math.sqrt(c.reduce((s, v, j) => s + (v - next[i][j]) ** 2, 0))));
    centroids = next;
    if (shift < tol) break;
  }
  return centroids;
}
\`\`\``,
          desc: 'Lloyd iteration. Random init; re-run for stability.',
        },
      },
      cosine_similarity: {
        python: {
          title: 'Cosine Similarity',
          code: `\`\`\`python
import math

def cosine_similarity(a, b):
    if len(a) != len(b): raise ValueError('length mismatch')
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0: return 0.0
    return dot / (na * nb)

# Usage:
print(cosine_similarity([1, 2, 3], [2, 4, 6]))  # 1.0
\`\`\``,
          desc: 'Dot product divided by L2 norms. Range [-1, 1]. Good for embedding comparison.',
        },
        javascript: {
          title: 'Cosine Similarity',
          code: `\`\`\`javascript
function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error('length mismatch');
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? dot / Math.sqrt(na * nb) : 0;
}
\`\`\``,
          desc: 'Single-pass dot + norms. Range [-1, 1].',
        },
      },
      euclidean_distance: {
        python: {
          title: 'Euclidean Distance (n-dim)',
          code: `\`\`\`python
import math

def euclidean_distance(a, b):
    if len(a) != len(b): raise ValueError('length mismatch')
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))

# Usage:
print(euclidean_distance([1, 2, 3], [4, 5, 6]))  # 5.196...
\`\`\``,
          desc: 'Straight-line distance in n dimensions.',
        },
        javascript: {
          title: 'Euclidean Distance (n-dim)',
          code: `\`\`\`javascript
function euclideanDistance(a, b) {
  if (a.length !== b.length) throw new Error('length mismatch');
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}
\`\`\``,
          desc: 'Straight-line distance in n dimensions.',
        },
      },
      softmax: {
        python: {
          title: 'Softmax (numerically stable)',
          code: `\`\`\`python
import math

def softmax(xs):
    m = max(xs)
    exps = [math.exp(x - m) for x in xs]
    s = sum(exps)
    return [e / s for e in exps]

# Usage:
print(softmax([1.0, 2.0, 3.0]))  # [0.0900, 0.2447, 0.6652]
\`\`\``,
          desc: 'Subtract max before exp to avoid overflow. Sums to 1.',
        },
        javascript: {
          title: 'Softmax (numerically stable)',
          code: `\`\`\`javascript
function softmax(xs) {
  const m = Math.max(...xs);
  const exps = xs.map(x => Math.exp(x - m));
  const s = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / s);
}
\`\`\``,
          desc: 'max-subtract trick for numerical stability.',
        },
      },
      matrix_multiply: {
        python: {
          title: 'Matrix Multiplication',
          code: `\`\`\`python
def matrix_multiply(A, B):
    if not A or not B or len(A[0]) != len(B): raise ValueError('shape mismatch')
    n, m, p = len(A), len(A[0]), len(B[0])
    C = [[0] * p for _ in range(n)]
    for i in range(n):
        for k in range(m):
            aik = A[i][k]
            for j in range(p):
                C[i][j] += aik * B[k][j]
    return C

# Usage:
print(matrix_multiply([[1,2],[3,4]], [[5,6],[7,8]]))  # [[19,22],[43,50]]
\`\`\``,
          desc: 'ikj loop ordering is cache-friendly. For any real workload use numpy.dot.',
        },
        javascript: {
          title: 'Matrix Multiplication',
          code: `\`\`\`javascript
function matMul(A, B) {
  if (!A.length || !B.length || A[0].length !== B.length) throw new Error('shape mismatch');
  const n = A.length, m = A[0].length, p = B[0].length;
  const C = Array.from({ length: n }, () => new Array(p).fill(0));
  for (let i = 0; i < n; i++)
    for (let k = 0; k < m; k++) {
      const aik = A[i][k];
      for (let j = 0; j < p; j++) C[i][j] += aik * B[k][j];
    }
  return C;
}
\`\`\``,
          desc: 'ikj ordering for cache locality.',
        },
      },

      // ─── BATCH 10: POWER TOOLS ───
      rate_limiter: {
        python: {
          title: 'Token Bucket Rate Limiter',
          code: `\`\`\`python
import time, threading

class TokenBucket:
    def __init__(self, rate, capacity):
        self.rate = rate
        self.capacity = capacity
        self.tokens = capacity
        self.last = time.monotonic()
        self.lock = threading.Lock()
    def consume(self, n=1):
        with self.lock:
            now = time.monotonic()
            elapsed = now - self.last
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            self.last = now
            if self.tokens >= n:
                self.tokens -= n
                return True
            return False

# Usage:
bucket = TokenBucket(rate=10, capacity=20)  # 10 tokens/sec, burst 20
if bucket.consume(): do_work()
\`\`\``,
          desc: 'Thread-safe token bucket. Tokens refill at `rate` per second, capped at `capacity` (burst size).',
        },
        javascript: {
          title: 'Token Bucket Rate Limiter',
          code: `\`\`\`javascript
class TokenBucket {
  constructor(rate, capacity) {
    this.rate = rate;
    this.capacity = capacity;
    this.tokens = capacity;
    this.last = performance.now() / 1000;
  }
  consume(n = 1) {
    const now = performance.now() / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.rate);
    this.last = now;
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
}

// Usage:
// const bucket = new TokenBucket(10, 20);
// if (bucket.consume()) doWork();
\`\`\``,
          desc: 'Token bucket. Single-threaded JS so no lock needed. performance.now() gives monotonic time.',
        },
      },
      circuit_breaker: {
        python: {
          title: 'Circuit Breaker',
          code: `\`\`\`python
import time
from enum import Enum

class State(Enum):
    CLOSED = 1; OPEN = 2; HALF_OPEN = 3

class CircuitBreaker:
    def __init__(self, threshold=5, cooldown=30):
        self.threshold = threshold
        self.cooldown = cooldown
        self.failures = 0
        self.state = State.CLOSED
        self.opened_at = 0
    def call(self, fn, *args, **kwargs):
        if self.state == State.OPEN:
            if time.monotonic() - self.opened_at >= self.cooldown:
                self.state = State.HALF_OPEN
            else:
                raise RuntimeError('circuit open')
        try:
            result = fn(*args, **kwargs)
            self.failures = 0
            self.state = State.CLOSED
            return result
        except Exception:
            self.failures += 1
            if self.failures >= self.threshold:
                self.state = State.OPEN
                self.opened_at = time.monotonic()
            raise

# Usage:
# cb = CircuitBreaker(threshold=3, cooldown=30)
# cb.call(flaky_api)
\`\`\``,
          desc: 'CLOSED → OPEN on consecutive failures → HALF_OPEN after cooldown → CLOSED on success. Prevents cascading failures.',
        },
        javascript: {
          title: 'Circuit Breaker',
          code: `\`\`\`javascript
class CircuitBreaker {
  constructor({ threshold = 5, cooldown = 30000 } = {}) {
    this.threshold = threshold;
    this.cooldown = cooldown;
    this.failures = 0;
    this.state = 'CLOSED';
    this.openedAt = 0;
  }
  async call(fn, ...args) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.openedAt >= this.cooldown) this.state = 'HALF_OPEN';
      else throw new Error('circuit open');
    }
    try {
      const result = await fn(...args);
      this.failures = 0; this.state = 'CLOSED';
      return result;
    } catch (err) {
      this.failures++;
      if (this.failures >= this.threshold) { this.state = 'OPEN'; this.openedAt = Date.now(); }
      throw err;
    }
  }
}
\`\`\``,
          desc: 'Three-state CB: CLOSED, OPEN, HALF_OPEN.',
        },
      },
      lru_with_ttl: {
        python: {
          title: 'LRU Cache with TTL',
          code: `\`\`\`python
import time
from collections import OrderedDict

class LRUCache:
    def __init__(self, capacity, ttl):
        self.capacity = capacity
        self.ttl = ttl
        self.cache = OrderedDict()
    def get(self, key):
        if key not in self.cache: return None
        value, expires = self.cache[key]
        if time.monotonic() > expires:
            del self.cache[key]
            return None
        self.cache.move_to_end(key)
        return value
    def put(self, key, value):
        self.cache[key] = (value, time.monotonic() + self.ttl)
        self.cache.move_to_end(key)
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)

# Usage:
cache = LRUCache(capacity=100, ttl=60)
cache.put('user:1', {'name': 'Ada'})
print(cache.get('user:1'))
\`\`\``,
          desc: 'OrderedDict provides O(1) LRU plus per-entry expiry. Expired entries are lazily evicted on access.',
        },
        javascript: {
          title: 'LRU Cache with TTL',
          code: `\`\`\`javascript
class LRUCache {
  constructor(capacity, ttlMs) {
    this.capacity = capacity;
    this.ttl = ttlMs;
    this.cache = new Map();
  }
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) { this.cache.delete(key); return null; }
    this.cache.delete(key); this.cache.set(key, entry);
    return entry.value;
  }
  put(key, value) {
    if (this.cache.has(key)) this.cache.delete(key);
    this.cache.set(key, { value, expires: Date.now() + this.ttl });
    if (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value);
  }
}
\`\`\``,
          desc: 'Map preserves insertion order — reinsertion is how LRU is tracked.',
        },
      },
      state_machine: {
        python: {
          title: 'Finite State Machine',
          code: `\`\`\`python
class StateMachine:
    def __init__(self, initial, transitions):
        self.state = initial
        # transitions: {(state, event): next_state}
        self.transitions = transitions
    def fire(self, event):
        key = (self.state, event)
        if key not in self.transitions:
            raise ValueError(f'invalid transition {self.state} --{event}-->')
        self.state = self.transitions[key]
        return self.state

# Usage:
transitions = {
    ('idle', 'start'): 'running',
    ('running', 'pause'): 'paused',
    ('paused', 'resume'): 'running',
    ('running', 'stop'): 'idle',
    ('paused', 'stop'): 'idle',
}
sm = StateMachine('idle', transitions)
print(sm.fire('start'))  # running
print(sm.fire('stop'))   # idle
\`\`\``,
          desc: 'Table-driven FSM. For complex state use a library like transitions or statechart.',
        },
        javascript: {
          title: 'Finite State Machine',
          code: `\`\`\`javascript
class StateMachine {
  constructor(initial, transitions) {
    this.state = initial;
    this.transitions = transitions; // { state: { event: nextState } }
  }
  fire(event) {
    const next = this.transitions[this.state]?.[event];
    if (!next) throw new Error(\`invalid transition \${this.state} --\${event}-->\`);
    this.state = next;
    return this.state;
  }
}

// Usage:
const sm = new StateMachine('idle', {
  idle: { start: 'running' },
  running: { pause: 'paused', stop: 'idle' },
  paused: { resume: 'running', stop: 'idle' },
});
\`\`\``,
          desc: 'Nested-object FSM. For richer semantics use XState.',
        },
      },
      pub_sub: {
        python: {
          title: 'Pub/Sub (Observer)',
          code: `\`\`\`python
from collections import defaultdict

class PubSub:
    def __init__(self):
        self.subscribers = defaultdict(list)
    def subscribe(self, topic, handler):
        self.subscribers[topic].append(handler)
        return lambda: self.subscribers[topic].remove(handler)
    def publish(self, topic, *args, **kwargs):
        for h in list(self.subscribers[topic]):
            h(*args, **kwargs)

# Usage:
bus = PubSub()
unsub = bus.subscribe('orders', lambda o: print('order', o))
bus.publish('orders', {'id': 1})
\`\`\``,
          desc: 'In-process pub/sub. For network pub/sub use Redis or NATS.',
        },
        javascript: {
          title: 'Pub/Sub (Observer)',
          code: `\`\`\`javascript
class PubSub {
  constructor() { this.subs = new Map(); }
  subscribe(topic, handler) {
    if (!this.subs.has(topic)) this.subs.set(topic, new Set());
    this.subs.get(topic).add(handler);
    return () => this.subs.get(topic)?.delete(handler);
  }
  publish(topic, ...args) {
    for (const h of [...(this.subs.get(topic) ?? [])]) h(...args);
  }
}
\`\`\``,
          desc: 'Set-backed topic subscribers. `subscribe` returns an unsubscribe function.',
        },
      },
      binary_search_first: {
        python: {
          title: 'Binary Search (first occurrence / lower bound)',
          code: `\`\`\`python
from bisect import bisect_left

def first_occurrence(arr, target):
    i = bisect_left(arr, target)
    if i < len(arr) and arr[i] == target: return i
    return -1

# Usage:
print(first_occurrence([1, 2, 2, 2, 3, 4], 2))  # 1
\`\`\``,
          desc: 'bisect_left gives the leftmost insertion point. O(log n). Hand-rolled variant is a tight loop on lo/hi.',
        },
        javascript: {
          title: 'Binary Search (first occurrence / lower bound)',
          code: `\`\`\`javascript
function firstOccurrence(arr, target) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo < arr.length && arr[lo] === target ? lo : -1;
}
\`\`\``,
          desc: 'Lower-bound variant. O(log n).',
        },
      },
      binary_search_last: {
        python: {
          title: 'Binary Search (last occurrence / upper bound)',
          code: `\`\`\`python
from bisect import bisect_right

def last_occurrence(arr, target):
    i = bisect_right(arr, target) - 1
    if 0 <= i < len(arr) and arr[i] == target: return i
    return -1

# Usage:
print(last_occurrence([1, 2, 2, 2, 3, 4], 2))  # 3
\`\`\``,
          desc: 'bisect_right gives the rightmost insertion point; minus one locates the last equal element.',
        },
        javascript: {
          title: 'Binary Search (last occurrence / upper bound)',
          code: `\`\`\`javascript
function lastOccurrence(arr, target) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  return i >= 0 && arr[i] === target ? i : -1;
}
\`\`\``,
          desc: 'Upper-bound variant. O(log n).',
        },
      },
      quickselect: {
        python: {
          title: 'Quickselect (kth smallest, Hoare)',
          code: `\`\`\`python
import random

def quickselect(arr, k):
    if k < 0 or k >= len(arr): raise IndexError('k out of range')
    a = list(arr)
    lo, hi = 0, len(a) - 1
    while lo <= hi:
        pivot = a[random.randint(lo, hi)]
        i, j = lo, hi
        while i <= j:
            while a[i] < pivot: i += 1
            while a[j] > pivot: j -= 1
            if i <= j:
                a[i], a[j] = a[j], a[i]
                i += 1; j -= 1
        if k <= j: hi = j
        elif k >= i: lo = i
        else: return a[k]
    return a[k]

# Usage:
print(quickselect([3, 1, 4, 1, 5, 9, 2, 6], 3))  # 3
\`\`\``,
          desc: 'Hoare-partition quickselect with random pivot. Expected O(n). Use heapq.nsmallest/nlargest for k near bounds.',
        },
        javascript: {
          title: 'Quickselect (kth smallest, Hoare)',
          code: `\`\`\`javascript
function quickselect(arr, k) {
  if (k < 0 || k >= arr.length) throw new RangeError('k out of range');
  const a = [...arr];
  let lo = 0, hi = a.length - 1;
  while (lo <= hi) {
    const pivot = a[lo + ((Math.random() * (hi - lo + 1)) | 0)];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) { [a[i], a[j]] = [a[j], a[i]]; i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}
\`\`\``,
          desc: 'Hoare-partition quickselect. Expected O(n).',
        },
      },
      top_k_frequent: {
        python: {
          title: 'Top K Frequent Elements',
          code: `\`\`\`python
from collections import Counter
import heapq

def top_k_frequent(nums, k):
    counts = Counter(nums)
    return [item for item, _ in heapq.nlargest(k, counts.items(), key=lambda kv: kv[1])]

# Usage:
print(top_k_frequent([1, 1, 1, 2, 2, 3], 2))  # [1, 2]
\`\`\``,
          desc: 'Counter + heapq.nlargest. O(n log k).',
        },
        javascript: {
          title: 'Top K Frequent Elements',
          code: `\`\`\`javascript
function topKFrequent(nums, k) {
  const counts = new Map();
  for (const n of nums) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([v]) => v);
}
\`\`\``,
          desc: 'Simple sort-then-slice. O(n log n). For huge n switch to a size-k min-heap.',
        },
      },
      top_k_largest: {
        python: {
          title: 'Top K Largest Elements',
          code: `\`\`\`python
import heapq

def top_k_largest(nums, k):
    return heapq.nlargest(k, nums)

# Usage:
print(top_k_largest([3, 2, 1, 5, 6, 4], 2))  # [6, 5]
\`\`\``,
          desc: 'heapq.nlargest maintains a size-k min-heap internally. O(n log k).',
        },
        javascript: {
          title: 'Top K Largest Elements',
          code: `\`\`\`javascript
function topKLargest(nums, k) {
  return [...nums].sort((a, b) => b - a).slice(0, k);
}
\`\`\``,
          desc: 'Sort-and-slice. O(n log n). Use a min-heap for O(n log k) on huge arrays.',
        },
      },
    };
