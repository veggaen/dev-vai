import { describe, it, expect, beforeAll } from 'vitest';
import { VaiEngine } from '../src/models/vai-engine.js';

// Data-driven matrix: every canonical key in `tryAlgorithmCodeGen` paired with
// 1–2 representative phrasings a human might actually type. This locks in
// routing so that future regex/pattern edits can't silently break any intent.
//
// New canonical keys MUST be added here with at least one phrasing before
// landing. A canonical key is "locked in" when a representative phrasing
// returns a non-null template containing the expected title keyword.
//
// Phrasings are chosen to match the regex-hardened patterns in vai-engine.ts
// and are the same vocabulary exercised by the project's scenario bench.

type MatrixEntry = {
  phrasings: string[];
  titleKeyword: RegExp; // substring/regex that must appear in the returned template title
};

const ROUTING_MATRIX: Record<string, MatrixEntry> = {
  // ── Batch 1: strings + array core ──
  reverse_string: { phrasings: ['write a function to reverse a string', 'implement reverse string'], titleKeyword: /reverse string/i },
  reverse_words: { phrasings: ['write a function to reverse the words in a sentence'], titleKeyword: /reverse words/i },
  palindrome_check: { phrasings: ['write a palindrome check function'], titleKeyword: /palindrome/i },
  count_vowels: { phrasings: ['write a function to count vowels in a string'], titleKeyword: /vowel/i },
  anagram_check: { phrasings: ['write an anagram check'], titleKeyword: /anagram/i },
  capitalize: { phrasings: ['write a function to capitalize the first letter of a string'], titleKeyword: /capitalize/i },
  title_case: { phrasings: ['write a function to title-case each word in a string'], titleKeyword: /title case/i },
  slugify: { phrasings: ['write a function to slugify a string'], titleKeyword: /slug/i },
  to_camel_case: { phrasings: ['write a function to convert a string to camelCase'], titleKeyword: /camel/i },
  to_snake_case: { phrasings: ['write a function to convert a string to snake_case'], titleKeyword: /snake/i },
  to_kebab_case: { phrasings: ['write a function to convert a string to kebab-case'], titleKeyword: /kebab/i },
  word_count: { phrasings: ['write a function to count the words in a string'], titleKeyword: /count words/i },
  char_count: { phrasings: ['write a function to count the characters in a string'], titleKeyword: /characters/i },
  remove_whitespace: { phrasings: ['write a function to remove all whitespace from a string'], titleKeyword: /whitespace/i },
  truncate_string: { phrasings: ['write a function to truncate a string with an ellipsis'], titleKeyword: /truncate/i },
  chunk_array: { phrasings: ['write a function to chunk an array into groups of 3'], titleKeyword: /chunk/i },
  unique_array: { phrasings: ['write a function to get unique values in an array'], titleKeyword: /unique/i },
  group_by: { phrasings: ['write a groupBy function for an array'], titleKeyword: /group by/i },
  partition_array: { phrasings: ['write a function to partition an array by a predicate'], titleKeyword: /partition/i },
  zip_arrays: { phrasings: ['write a function to zip two arrays'], titleKeyword: /zip/i },
  range_array: { phrasings: ['write a function to generate a range of numbers from 1 to 10'], titleKeyword: /range/i },
  flatten_deep: { phrasings: ['write a function to flatten a deeply nested array'], titleKeyword: /flatten/i },
  intersection: { phrasings: ['write a function to compute the intersection of two arrays'], titleKeyword: /intersection/i },
  union_arrays: { phrasings: ['write a function to compute the union of two arrays'], titleKeyword: /union/i },
  rotate_array: { phrasings: ['write a function to rotate an array by 2 positions'], titleKeyword: /rotate/i },
  find_max: { phrasings: ['write a function to find the maximum in an array'], titleKeyword: /maximum/i },
  find_min: { phrasings: ['write a function to find the minimum in an array'], titleKeyword: /minimum/i },
  sum_array: { phrasings: ['write a function to sum an array'], titleKeyword: /sum/i },
  average_array: { phrasings: ['write a function to compute the average of an array'], titleKeyword: /average|mean/i },
  count_occurrences: { phrasings: ['write a function to count occurrences of an element in an array'], titleKeyword: /occurrences|count/i },
  flatten_array: { phrasings: ['write an array flatten function'], titleKeyword: /flatten/i },
  matrix_transpose: { phrasings: ['write a function to transpose a matrix'], titleKeyword: /transpose/i },

  // ── sort/search ──
  binary_search: { phrasings: ['implement binary search', 'write a binary search'], titleKeyword: /binary search/i },
  linear_search: { phrasings: ['write a linear search'], titleKeyword: /linear search/i },
  interpolation_search: { phrasings: ['implement interpolation search'], titleKeyword: /interpolation/i },
  bubble_sort: { phrasings: ['implement bubble sort'], titleKeyword: /bubble/i },
  selection_sort: { phrasings: ['implement selection sort'], titleKeyword: /selection sort/i },
  insertion_sort: { phrasings: ['implement insertion sort'], titleKeyword: /insertion sort/i },
  merge_sort: { phrasings: ['implement merge sort'], titleKeyword: /merge sort/i },
  quicksort: { phrasings: ['implement quicksort'], titleKeyword: /quicksort|quick sort/i },
  heapsort: { phrasings: ['implement heapsort'], titleKeyword: /heap sort|heapsort/i },
  counting_sort: { phrasings: ['implement counting sort'], titleKeyword: /counting sort/i },
  radix_sort: { phrasings: ['implement radix sort'], titleKeyword: /radix/i },

  // ── recursion/math ──
  factorial_recursive: { phrasings: ['write a recursive factorial function'], titleKeyword: /factorial/i },
  factorial_iterative: { phrasings: ['write an iterative factorial function'], titleKeyword: /factorial/i },
  fibonacci_recursive: { phrasings: ['write a recursive fibonacci function'], titleKeyword: /fibonacci/i },
  fibonacci_iterative: { phrasings: ['write an iterative fibonacci function'], titleKeyword: /fibonacci/i },
  fibonacci_memo: { phrasings: ['write a memoized fibonacci function'], titleKeyword: /fibonacci/i },
  gcd_recursive: { phrasings: ['write a recursive gcd function'], titleKeyword: /gcd|euclidean/i },
  gcd_iterative: { phrasings: ['implement iterative gcd'], titleKeyword: /gcd|euclidean/i },
  extended_gcd: { phrasings: ['implement extended euclidean algorithm'], titleKeyword: /extended|euclidean/i },
  power_recursive: { phrasings: ['write a recursive power function'], titleKeyword: /power/i },
  fast_power: { phrasings: ['implement fast power exponentiation by squaring'], titleKeyword: /fast power|exponentiation/i },
  mod_pow: { phrasings: ['write modular exponentiation'], titleKeyword: /modular|mod pow/i },
  is_prime: { phrasings: ['write a function to check if a number is prime'], titleKeyword: /prime/i },
  sieve: { phrasings: ['write sieve of eratosthenes'], titleKeyword: /sieve/i },
  lcm_function: { phrasings: ['write a function for lcm'], titleKeyword: /lcm/i },
  prime_factorization: { phrasings: ['write a function for prime factorization'], titleKeyword: /prime factor/i },
  nth_prime: { phrasings: ['write a function to find the nth prime'], titleKeyword: /prime/i },
  digit_sum: { phrasings: ['write sum of digits'], titleKeyword: /digit/i },
  reverse_integer: { phrasings: ['write a function to reverse an integer'], titleKeyword: /reverse/i },
  is_power_of_two: { phrasings: ['write is power of two check'], titleKeyword: /power of two/i },
  pascal_triangle: { phrasings: ["write code to generate pascal's triangle"], titleKeyword: /pascal/i },
  is_armstrong: { phrasings: ['write a function for armstrong number check'], titleKeyword: /armstrong/i },

  // ── bit manip / number theory (batch 2) ──
  count_set_bits: { phrasings: ['write a function to count set bits', 'implement hamming weight'], titleKeyword: /set bits|hamming/i },
  hamming_distance: { phrasings: ['implement hamming distance between two numbers'], titleKeyword: /hamming distance/i },
  single_number: { phrasings: ['write code for the single number problem'], titleKeyword: /single number|xor/i },
  missing_number: { phrasings: ['write a function to find the missing number in an array'], titleKeyword: /missing/i },
  gray_code: { phrasings: ['generate gray code sequence'], titleKeyword: /gray/i },
  power_of_four: { phrasings: ['implement is power of four check'], titleKeyword: /power of four/i },
  next_power_of_two: { phrasings: ['write a function for next power of two'], titleKeyword: /next power|power of two/i },
  euler_totient: { phrasings: ["write euler's totient function", 'implement phi function'], titleKeyword: /totient|euler/i },
  integer_sqrt: { phrasings: ['write integer square root'], titleKeyword: /integer square root|isqrt/i },
  two_sum: { phrasings: ['write code for two sum problem'], titleKeyword: /two sum/i },
  three_sum: { phrasings: ['implement three sum'], titleKeyword: /three sum/i },

  // ── data structures ──
  stack_class: { phrasings: ['implement a stack class'], titleKeyword: /stack/i },
  queue_class: { phrasings: ['implement a queue class'], titleKeyword: /queue/i },
  bst_insert: { phrasings: ['implement a binary search tree'], titleKeyword: /bst|binary search tree/i },
  bst_search: { phrasings: ['implement bst search'], titleKeyword: /bst search|binary search tree/i },
  linked_list: { phrasings: ['implement a linked list'], titleKeyword: /linked list/i },
  doubly_linked_list: { phrasings: ['implement a doubly linked list'], titleKeyword: /doubly/i },
  deque: { phrasings: ['implement a deque'], titleKeyword: /deque/i },
  lru_cache: { phrasings: ['implement an lru cache'], titleKeyword: /lru/i },
  trie: { phrasings: ['implement a trie'], titleKeyword: /trie/i },
  heap: { phrasings: ['implement a binary heap'], titleKeyword: /heap/i },
  union_find: { phrasings: ['implement union find'], titleKeyword: /union find|disjoint/i },

  // ── trees ──
  tree_inorder: { phrasings: ['write inorder traversal'], titleKeyword: /inorder|traversal/i },
  tree_preorder: { phrasings: ['write preorder traversal'], titleKeyword: /preorder|traversal/i },
  tree_postorder: { phrasings: ['write postorder traversal'], titleKeyword: /postorder|traversal/i },
  tree_levelorder: { phrasings: ['write level order traversal'], titleKeyword: /level.*order|traversal/i },
  tree_height: { phrasings: ['write a function to compute the height of a tree'], titleKeyword: /height|depth/i },
  tree_invert: { phrasings: ['write a function to invert a binary tree'], titleKeyword: /invert/i },
  tree_path_sum: { phrasings: ['implement path sum in a binary tree'], titleKeyword: /path sum/i },

  // ── graphs ──
  bfs_graph: { phrasings: ['implement bfs on a graph'], titleKeyword: /bfs|breadth/i },
  dfs_graph: { phrasings: ['implement dfs on a graph'], titleKeyword: /dfs|depth/i },
  dijkstra: { phrasings: ["implement dijkstra's algorithm"], titleKeyword: /dijkstra/i },
  topological_sort: { phrasings: ['implement topological sort'], titleKeyword: /topological/i },
  detect_cycle_graph: { phrasings: ['write a function to detect a cycle in a graph'], titleKeyword: /cycle/i },
  bellman_ford: { phrasings: ['implement bellman ford'], titleKeyword: /bellman/i },
  floyd_warshall: { phrasings: ['implement floyd warshall'], titleKeyword: /floyd/i },
  kruskal_mst: { phrasings: ["implement kruskal's mst"], titleKeyword: /kruskal|mst/i },
  prim_mst: { phrasings: ["implement prim's mst"], titleKeyword: /prim|mst/i },
  a_star: { phrasings: ['implement a star pathfinding'], titleKeyword: /a\*|a star/i },
  tarjan_scc: { phrasings: ["implement tarjan's scc"], titleKeyword: /tarjan|scc/i },
  articulation_points: { phrasings: ['implement articulation points'], titleKeyword: /articulation/i },
  max_flow: { phrasings: ['implement max flow'], titleKeyword: /max flow|ford.*fulkerson/i },

  // ── dp ──
  coin_change: { phrasings: ['implement coin change dp'], titleKeyword: /coin change/i },
  edit_distance: { phrasings: ['implement edit distance'], titleKeyword: /edit distance|levenshtein/i },
  lcs: { phrasings: ['implement longest common subsequence'], titleKeyword: /longest common|lcs/i },
  knapsack: { phrasings: ['implement 0/1 knapsack'], titleKeyword: /knapsack/i },
  kadane_max_subarray: { phrasings: ["implement kadane's algorithm"], titleKeyword: /kadane|max subarray/i },
  longest_increasing_subseq: { phrasings: ['implement longest increasing subsequence'], titleKeyword: /increasing subseq|lis/i },
  climb_stairs: { phrasings: ['implement climbing stairs dp'], titleKeyword: /climb|stairs/i },
  house_robber: { phrasings: ['implement house robber dp'], titleKeyword: /house robber/i },
  unique_paths: { phrasings: ['implement unique paths in a grid'], titleKeyword: /unique paths/i },
  matrix_chain: { phrasings: ['implement matrix chain multiplication'], titleKeyword: /matrix chain/i },
  rod_cutting: { phrasings: ['implement rod cutting dp'], titleKeyword: /rod/i },
  subset_sum: { phrasings: ['implement subset sum dp'], titleKeyword: /subset sum/i },
  min_path_sum: { phrasings: ['implement min path sum'], titleKeyword: /min path|minimum path/i },
  jump_game: { phrasings: ['implement jump game dp'], titleKeyword: /jump/i },
  word_break: { phrasings: ['implement word break dp'], titleKeyword: /word break/i },
  decode_ways: { phrasings: ['implement decode ways dp'], titleKeyword: /decode ways/i },
  palindrome_partition: { phrasings: ['implement palindrome partitioning'], titleKeyword: /palindrome/i },

  // ── backtracking ──
  n_queens: { phrasings: ['implement n queens'], titleKeyword: /n.queens/i },
  sudoku_solver: { phrasings: ['write code to solve a sudoku'], titleKeyword: /sudoku/i },
  permutations: { phrasings: ['write a function to generate all permutations'], titleKeyword: /permutation/i },
  combinations: { phrasings: ['write a combinations function', 'implement binomial coefficient'], titleKeyword: /combination|binomial/i },
  generate_parentheses: { phrasings: ['write a function to generate parentheses'], titleKeyword: /parenthes/i },
  subsets: { phrasings: ['write a function to generate all subsets'], titleKeyword: /subset|power set/i },
  combination_sum: { phrasings: ['implement combination sum'], titleKeyword: /combination sum/i },

  // ── string algos ──
  kmp_search: { phrasings: ['implement kmp search algorithm'], titleKeyword: /kmp/i },
  rabin_karp: { phrasings: ['implement rabin karp substring search'], titleKeyword: /rabin/i },
  z_algorithm: { phrasings: ['implement the z algorithm'], titleKeyword: /z algorithm|z.function/i },
  string_rotation_check: { phrasings: ['write a function to check if two strings are rotations'], titleKeyword: /rotation/i },
  longest_common_substring: { phrasings: ['implement longest common substring'], titleKeyword: /longest common substring/i },
  longest_palindrome_substring: { phrasings: ['implement longest palindromic substring'], titleKeyword: /palindromic substring/i },
  levenshtein: { phrasings: ['implement levenshtein distance'], titleKeyword: /levenshtein|edit distance/i },
  regex_match: { phrasings: ['implement regex matching', 'implement regular expression matching'], titleKeyword: /regex|pattern match|regular expression/i },
  wildcard_match: { phrasings: ['implement wildcard matching'], titleKeyword: /wildcard/i },

  // ── geometry ──
  convex_hull: { phrasings: ['implement convex hull'], titleKeyword: /convex hull/i },
  point_distance: { phrasings: ['implement distance formula', 'implement distance between two points'], titleKeyword: /distance|point/i },
  polygon_area: { phrasings: ['implement polygon area'], titleKeyword: /polygon area|shoelace/i },
  line_intersection: { phrasings: ['implement line segment intersection'], titleKeyword: /line.*intersection|segment.*intersection/i },

  // ── Batch 5: advanced data structures ──
  segment_tree: { phrasings: ['implement a segment tree'], titleKeyword: /segment tree/i },
  fenwick_tree: { phrasings: ['implement a fenwick tree', 'implement binary indexed tree'], titleKeyword: /fenwick|binary indexed/i },
  sparse_table: { phrasings: ['implement a sparse table'], titleKeyword: /sparse table/i },
  monotonic_stack: { phrasings: ['implement a monotonic stack'], titleKeyword: /monotonic stack|next greater/i },
  monotonic_queue: { phrasings: ['implement a monotonic queue'], titleKeyword: /monotonic|sliding window max/i },
  suffix_array: { phrasings: ['implement a suffix array'], titleKeyword: /suffix array/i },
  bloom_filter: { phrasings: ['implement a bloom filter'], titleKeyword: /bloom filter/i },
  skip_list: { phrasings: ['implement a skip list'], titleKeyword: /skip list/i },
  circular_buffer: { phrasings: ['implement a circular buffer', 'implement a ring buffer'], titleKeyword: /circular|ring/i },
  disjoint_set_forest: { phrasings: ['implement a disjoint set forest'], titleKeyword: /disjoint set|union find/i },

  // ── Batch 6: web/dev utilities ──
  parse_url: { phrasings: ['write a function to parse a url'], titleKeyword: /url|parse url/i },
  build_query_string: { phrasings: ['implement build query string', 'write a function to build a query string from an object'], titleKeyword: /query string/i },
  escape_html: { phrasings: ['implement escape html', 'write a function to sanitize html entities'], titleKeyword: /escape html|html entities/i },
  url_encode: { phrasings: ['implement url encode'], titleKeyword: /url encode|url encoding/i },
  base64_encode: { phrasings: ['implement base64 encode'], titleKeyword: /base64/i },
  md5_hash: { phrasings: ['implement md5 hash'], titleKeyword: /md5/i },
  sha256_hash: { phrasings: ['implement sha256 hash'], titleKeyword: /sha.?256/i },
  safe_compare: { phrasings: ['write safe compare', 'implement timing safe compare'], titleKeyword: /safe compare|timing.safe|constant.time/i },
  uuid_v4: { phrasings: ['generate a uuid v4'], titleKeyword: /uuid/i },
  validate_email: { phrasings: ['implement validate email'], titleKeyword: /email/i },
  validate_phone: { phrasings: ['write validate phone number'], titleKeyword: /phone/i },
  format_currency: { phrasings: ['implement format currency'], titleKeyword: /currency/i },
  format_bytes: { phrasings: ['implement format bytes'], titleKeyword: /bytes|byte size|human.?readable/i },
  mask_credit_card: { phrasings: ['write mask credit card'], titleKeyword: /mask|credit card/i },
  parse_cookies: { phrasings: ['implement parse cookies'], titleKeyword: /cook/i },

  // ── Batch 7: date/time + I/O ──
  format_date: { phrasings: ['implement format date'], titleKeyword: /format date|date format/i },
  parse_iso8601: { phrasings: ['write parse iso 8601', 'implement iso 8601 parser'], titleKeyword: /iso.?8601|iso date/i },
  date_diff_days: { phrasings: ['implement days between two dates'], titleKeyword: /days|date diff/i },
  is_leap_year: { phrasings: ['write is leap year'], titleKeyword: /leap year/i },
  day_of_week: { phrasings: ['implement day of week'], titleKeyword: /day of week|weekday/i },
  format_duration: { phrasings: ['write format duration'], titleKeyword: /duration/i },
  read_csv: { phrasings: ['implement read csv', 'write a function to parse a csv'], titleKeyword: /csv|parse csv/i },
  write_csv: { phrasings: ['implement write csv'], titleKeyword: /csv|write csv/i },
  walk_directory: { phrasings: ['write walk directory'], titleKeyword: /walk directory|directory walk/i },
  stream_file_lines: { phrasings: ['implement stream file lines'], titleKeyword: /stream file|file lines/i },

  // ── Batch 8: async patterns ──
  sleep: { phrasings: ['implement sleep function'], titleKeyword: /sleep|delay/i },
  promise_pool: { phrasings: ['implement promise pool', 'write limit parallel promises'], titleKeyword: /promise pool|parallel|concurrency/i },
  race_timeout: { phrasings: ['implement promise with timeout'], titleKeyword: /timeout|race/i },
  async_queue: { phrasings: ['implement async queue'], titleKeyword: /async.*queue|task queue/i },
  event_emitter: { phrasings: ['implement event emitter'], titleKeyword: /event emitter/i },
  sliding_window: { phrasings: ['implement sliding window iterator'], titleKeyword: /sliding window/i },
  pairwise: { phrasings: ['implement pairwise iterator'], titleKeyword: /pairwise/i },
  generator_chain: { phrasings: ['implement generator chain'], titleKeyword: /chain|generator/i },
  batch_async: { phrasings: ['write batch async requests'], titleKeyword: /batch/i },
  cancellable_fetch: { phrasings: ['implement cancellable fetch'], titleKeyword: /cancell|abort/i },

  // ── Batch 9: stats & ML basics ──
  percentile: { phrasings: ['implement percentile function'], titleKeyword: /percentile/i },
  moving_average: { phrasings: ['write moving average'], titleKeyword: /moving average/i },
  ema: { phrasings: ['implement exponential moving average'], titleKeyword: /exponential|ema/i },
  zscore: { phrasings: ['write z score'], titleKeyword: /z.?score/i },
  correlation: { phrasings: ['implement correlation coefficient'], titleKeyword: /correlation/i },
  covariance: { phrasings: ['implement covariance function'], titleKeyword: /covariance/i },
  linear_regression: { phrasings: ['implement linear regression', 'write least squares fit'], titleKeyword: /linear regression|least squares/i },
  k_means: { phrasings: ['implement k means'], titleKeyword: /k.?means/i },
  cosine_similarity: { phrasings: ['implement cosine similarity'], titleKeyword: /cosine/i },
  euclidean_distance: { phrasings: ['implement euclidean distance'], titleKeyword: /euclidean/i },
  softmax: { phrasings: ['implement softmax'], titleKeyword: /softmax/i },
  matrix_multiply: { phrasings: ['implement matrix multiplication'], titleKeyword: /matrix (?:multiply|multiplication)/i },
  mean: { phrasings: ['write a function to compute the mean of an array'], titleKeyword: /mean|average/i },
  median: { phrasings: ['write a function to compute the median of a list'], titleKeyword: /median/i },
  mode: { phrasings: ['write a function to compute the mode of a list of numbers'], titleKeyword: /mode/i },
  variance: { phrasings: ['write a function to compute the variance of an array'], titleKeyword: /variance/i },
  stddev: { phrasings: ['write a function to compute the standard deviation of numbers'], titleKeyword: /standard deviation|stddev|std dev/i },

  // ── Batch 10: power tools ──
  rate_limiter: { phrasings: ['implement rate limiter', 'implement token bucket'], titleKeyword: /rate limit|token bucket/i },
  circuit_breaker: { phrasings: ['implement circuit breaker'], titleKeyword: /circuit breaker/i },
  lru_with_ttl: { phrasings: ['implement lru cache with ttl'], titleKeyword: /lru|ttl/i },
  state_machine: { phrasings: ['implement finite state machine'], titleKeyword: /state machine|fsm/i },
  pub_sub: { phrasings: ['implement pub sub pattern', 'implement observer pattern'], titleKeyword: /pub.?sub|observer/i },
  binary_search_first: { phrasings: ['write binary search for first occurrence', 'write lower bound binary search'], titleKeyword: /first|lower bound/i },
  binary_search_last: { phrasings: ['write binary search for last occurrence', 'write upper bound binary search'], titleKeyword: /last|upper bound/i },
  quickselect: { phrasings: ['implement quickselect', 'write kth smallest element'], titleKeyword: /quickselect|kth/i },
  top_k_frequent: { phrasings: ['implement top k frequent'], titleKeyword: /top k frequent/i },
  top_k_largest: { phrasings: ['implement top k largest', 'write k largest elements'], titleKeyword: /top k largest|k largest/i },

  // ── utilities/misc ──
  deep_clone: { phrasings: ['implement deep clone an object'], titleKeyword: /deep clone/i },
  deep_equal: { phrasings: ['implement deep equal two objects'], titleKeyword: /deep equal/i },
  memoize: { phrasings: ['implement memoize a function'], titleKeyword: /memoize/i },
  curry: { phrasings: ['implement curry a function'], titleKeyword: /curry/i },
  compose: { phrasings: ['implement function composition'], titleKeyword: /compose|composition/i },
  pipe: { phrasings: ['implement pipe functions'], titleKeyword: /pipe/i },
  once: { phrasings: ['implement ensure a function runs once'], titleKeyword: /once/i },
  debounce: { phrasings: ['implement debounce function'], titleKeyword: /debounce/i },
  throttle: { phrasings: ['implement throttle function'], titleKeyword: /throttle/i },
  retry_backoff: { phrasings: ['implement retry with exponential backoff'], titleKeyword: /retry|backoff/i },
};

describe('tryAlgorithmCodeGen routing matrix (Part 1: strings, arrays, sort, math, bits)', () => {
  let engine: VaiEngine;

  beforeAll(() => {
    engine = new VaiEngine();
  });

  for (const [canonicalKey, { phrasings, titleKeyword }] of Object.entries(ROUTING_MATRIX)) {
    describe(canonicalKey, () => {
      for (const phrasing of phrasings) {
        it(`routes "${phrasing}"`, () => {
          const result = (engine as unknown as { tryAlgorithmCodeGen(input: string): string | null }).tryAlgorithmCodeGen(phrasing);
          expect(result, `canonical key "${canonicalKey}" failed to route phrasing "${phrasing}"`).not.toBeNull();
          expect(typeof result).toBe('string');
          expect(result!.length).toBeGreaterThan(50);
          expect(result!, `phrasing "${phrasing}" routed but title did not match ${titleKeyword}`).toMatch(titleKeyword);
        });
      }
    });
  }
});
