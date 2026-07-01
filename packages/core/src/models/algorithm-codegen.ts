/**
 * algorithm-codegen — extracted from VaiEngine (decomposition phase 2, slice 1).
 *
 * The algorithm/data-structure code-generation router: given a code-generation request, detect the
 * language + the algorithm and return the canonical template (or null when it isn't a code request
 * or no algorithm matches). Pure logic over the input string; its ONE dependency — the template
 * lookup — is INJECTED as `algoTemplate(algo, lang)` so this is a free function (no `this`).
 *
 * VaiEngine keeps a thin wrapper: `tryAlgorithmCodeGen(input) { return tryAlgorithmCodeGen(input, (a,l)=>this.algoTemplate(a,l)); }`.
 * Extracted verbatim (byte-identical output, proven by golden snapshot) — the only change is
 * `this.algoTemplate` → the injected `algoTemplate` param. Do NOT reformat; behaviour is pinned.
 */

export type AlgoTemplateFn = (algo: string, lang: string) => string;

export function tryAlgorithmCodeGen(input: string, algoTemplate: AlgoTemplateFn): string | null {
    // Must look like a code generation request. The old gate matched a bare build
    // verb ("make"/"create") ANYWHERE — so a prose/architect prompt that merely
    // *contained* "creating" ("...tasked with creating a complete spec...") or an
    // idea question fell into the algorithm-template lane and got answered with a
    // Python snippet (the "what is a good idea / how to tell if it's unique" →
    // combinations-snippet hijack). Require the build verb to actually be asking for
    // CODE: a code/algorithm/function noun must be present, and clearly non-code
    // framing (idea/concept/strategy/spec/architect prose) disqualifies the turn.
    // Non-code framing: idea/concept/strategy/spec/architect prose. When the prompt
    // is ABOUT an idea or a specification (not asking for a runnable algorithm), the
    // algorithm-template lane is off-limits even though the text contains a build verb
    // ("creating a spec", "make this prompt general"). This is the fix for the
    // "what is a good idea / how to tell if it's unique" → Python-combinations hijack.
    // "unique" only disqualifies when it's about an idea/concept/it ("is the idea
    // unique", "unique business idea") — NOT "unique values in an array" (real code).
    const NON_CODE_FRAMING = /\b(?:idea|ideas|concept|strateg(?:y|ies)|philosoph|advice|opinion|specification|architect|revival|revive|business|product\s+idea|what\s+makes\s+a|how\s+(?:do\s+i\s+)?(?:know|tell|decide|evaluate|judge)\s+(?:if|whether|how))\b/i;
    const UNIQUE_IDEA = /\b(?:idea|concept|it|this|that)\s+(?:is\s+)?unique\b|\bunique\s+(?:idea|concept|business|product|approach|angle|selling)\b/i;
    const buildVerb = /(?:write|implement|create|code|generate|make|build|show|give)\s+/i.test(input);
    const howToCode = /(?:how\s+(?:to|do\s+(?:i|you))\s+(?:implement|write|create|code|make|build))/i.test(input);
    const codeIntent = (buildVerb || howToCode) && !NON_CODE_FRAMING.test(input) && !UNIQUE_IDEA.test(input);
    if (!codeIntent) return null;

    // Detect language
    const langPatterns: [RegExp, string][] = [
      [/\b(?:in|using|with)\s+python\b/i, 'python'],
      [/\b(?:in|using|with)\s+(?:javascript|js)\b/i, 'javascript'],
      [/\b(?:in|using|with)\s+(?:typescript|ts)\b/i, 'typescript'],
      [/\b(?:in|using|with)\s+java\b(?!\s*script)/i, 'java'],
      [/\b(?:in|using|with)\s+(?:c\+\+|cpp)\b/i, 'cpp'],
      [/\b(?:in|using|with)\s+go(?:lang)?\b/i, 'go'],
      [/\bpython\b/i, 'python'],
      [/\b(?:javascript|js)\b/i, 'javascript'],
      [/\b(?:typescript|ts)\b/i, 'typescript'],
    ];
    let lang = 'python'; // default
    for (const [pat, l] of langPatterns) {
      if (pat.test(input)) { lang = l; break; }
    }

    // ─── Algorithm detection & template selection ───
    const lower = input.toLowerCase();

    // BST (check before binary search to avoid false match)
    if (/(?:binary\s+search\s+tree|bst)\s+(?:insert|class|implementation)/i.test(lower)
      || /(?:implement|write|create|build)\s+(?:me\s+)?(?:a\s+|an?\s+)?(?:binary\s+search\s+tree|bst)/i.test(lower)) return algoTemplate('bst_insert', lang);
    // Binary search (after BST check, before specialized first/last/lower/upper variants)
    if (/binary\s*search/i.test(lower)
      && !/binary\s*search\s*tree/i.test(lower)
      && !/\b(?:first|last|lower\s+bound|upper\s+bound|leftmost|rightmost)\b/i.test(lower)) return algoTemplate('binary_search', lang);
    // Bubble sort
    if (/bubble\s*sort/i.test(lower)) return algoTemplate('bubble_sort', lang);
    // Selection sort
    if (/selection\s*sort/i.test(lower)) return algoTemplate('selection_sort', lang);
    // Insertion sort
    if (/insertion\s*sort/i.test(lower)) return algoTemplate('insertion_sort', lang);
    // Merge sort
    if (/merge\s*sort/i.test(lower)) return algoTemplate('merge_sort', lang);
    // Recursive factorial (skip when user explicitly asks iterative)
    if (!/iterative\s+factorial|factorial\s+(?:iterative(?:ly)?|with\s+(?:a\s+)?loop|using\s+(?:a\s+)?loop)/i.test(lower)
      && (/(?:recursive\s+)?factorial\s+(?:function|method|algorithm)/i.test(lower)
        || /(?:function|method)\s+(?:for\s+|to\s+(?:compute\s+|calculate\s+)?)?factorial/i.test(lower))) return algoTemplate('factorial_recursive', lang);
    // Recursive fibonacci
    if (/(?:recursive\s+)?fibonacci\s+(?:function|method|algorithm)/i.test(lower)
      || /(?:function|method)\s+(?:for\s+|to\s+(?:compute\s+|calculate\s+)?)?fibonacci/i.test(lower)) return algoTemplate('fibonacci_recursive', lang);
    // Recursive GCD / Euclidean algorithm (skip extended/iterative variants handled in batch 2)
    if (!/\b(?:extended|iterative)\b/i.test(lower) && (
      /(?:recursive\s+)?(?:gcd|greatest\s+common\s+divisor|euclidean)\s+(?:function|method|algorithm)/i.test(lower)
      || /(?:function|method)\s+(?:for\s+|to\s+(?:find\s+|compute\s+|calculate\s+)?)?(?:gcd|greatest\s+common\s+divisor)/i.test(lower)
    )) return algoTemplate('gcd_recursive', lang);
    // Recursive power function
    if (/(?:recursive\s+)?(?:power|exponent(?:iation)?)\s+(?:function|method)/i.test(lower)
      || /(?:function|method)\s+(?:for\s+|to\s+(?:compute\s+|calculate\s+)?)?(?:power|exponent)/i.test(lower)) return algoTemplate('power_recursive', lang);
    // Stack implementation
    if (/stack\s+(?:class|implementation|data\s*structure)/i.test(lower)
      || /(?:implement|class\s+for)\s+(?:a\s+)?stack/i.test(lower)) return algoTemplate('stack_class', lang);
    // Queue implementation
    if (/queue\s+(?:class|implementation|data\s*structure)/i.test(lower)
      || /(?:implement|class\s+for)\s+(?:a\s+)?queue/i.test(lower)) return algoTemplate('queue_class', lang);
    // Reverse words in a sentence (check before reverse_string so "reverse
    // the words in a sentence" wins over the generic string-reversal pattern).
    // All alternatives require an explicit reverse/reversal cue to avoid matching
    // queries like "count the words in a string" or "title-case each word in a string".
    if (/revers(?:e|es|ed|ing)\s+(?:the\s+|all\s+(?:the\s+)?)?words?\b/i.test(lower)
      || /revers(?:e|es|ed|ing)\s+(?:the\s+|all\s+(?:the\s+)?)?words?\s+in\s+(?:a\s+|the\s+)?(?:sentence|string|phrase)/i.test(lower)
      || /(?:sentence|phrase)\s+revers(?:al|e|ing)/i.test(lower)) return algoTemplate('reverse_words', lang);
    // Reverse string
    if (/reverse\s+(?:a\s+)?string/i.test(lower)
      || /string\s+revers(?:al|e|ing)/i.test(lower)) return algoTemplate('reverse_string', lang);
    // Palindrome check
    if (/palindrome\s+(?:check|detect|test|function|validator)/i.test(lower)
      || /(?:check|detect|test|verify)\s+(?:if\s+)?(?:a\s+)?(?:string\s+is\s+(?:a\s+)?)?palindrome/i.test(lower)
      || /(?:is\s+)?palindrome/i.test(lower) && /function|write|implement|create/i.test(lower)) return algoTemplate('palindrome_check', lang);
    // Count vowels
    if (/count\s+vowels?/i.test(lower)
      || /vowel\s+count/i.test(lower)) return algoTemplate('count_vowels', lang);
    // Anagram check
    if (/anagram\s+(?:check|detect|test|function|validator)/i.test(lower)
      || /(?:check|detect|test|verify)\s+(?:if\s+)?.*anagram/i.test(lower)) return algoTemplate('anagram_check', lang);
    // Is prime — broad matching for "check if prime" / "prime number" / "is prime"
    if (/\bprime\b/i.test(lower) && !/sieve|eratosthenes|prime\s+factor|nth\s+prime|(?:find|get|list|generate)\s+(?:the\s+)?(?:nth\s+|all\s+|every\s+)?prime/i.test(lower)
      && (/check|test|verify|determin|function|method|write|implement/i.test(lower))) return algoTemplate('is_prime', lang);
    // Sieve of Eratosthenes
    if (/sieve\s+(?:of\s+)?eratosthenes/i.test(lower)
      || /eratosthenes/i.test(lower)
      || /(?:find|generate|list)\s+(?:all\s+)?primes?\s+(?:up\s+to|below|under|less\s+than)/i.test(lower)) return algoTemplate('sieve', lang);
    // LCM function — broad matching for lcm/least common multiple
    if (/\b(?:lcm|least\s+common\s+multiple)\b/i.test(lower)) return algoTemplate('lcm_function', lang);
    // Flatten array
    if (/flatten\s+(?:a\s+)?(?:nested\s+)?array/i.test(lower)
      || /(?:array|list)\s+flatten/i.test(lower)) return algoTemplate('flatten_array', lang);
    // Matrix transpose
    if (/matrix\s+transpose/i.test(lower)
      || /transpose\s+(?:a\s+)?matrix/i.test(lower)) return algoTemplate('matrix_transpose', lang);
    // Find max in array
    if (/(?:find|get)\s+(?:the\s+)?(?:max(?:imum)?|largest|biggest)\s+(?:element\s+)?(?:in\s+)?(?:an?\s+)?array/i.test(lower)
      || /max(?:imum)?\s+(?:element\s+)?(?:in\s+|of\s+)(?:an?\s+)?array/i.test(lower)) return algoTemplate('find_max', lang);

    // ─── STRING MANIPULATION ───
    // Title case — ordered before capitalize so "capitalize each word" routes here.
    if (/\btitle[\s-]?case\b/i.test(lower)
      || /capitalize\s+(?:each|every|all)\s+word/i.test(lower)) return algoTemplate('title_case', lang);
    // Slugify
    if (/\bslugify\b/i.test(lower)
      || /(?:url|string)\s+slug\b/i.test(lower)
      || /\bto\s+slug\b/i.test(lower)) return algoTemplate('slugify', lang);
    // Camel case conversion
    if (/\b(?:to\s+)?camel[\s-]?case\b/i.test(lower)
      || /\bcamelcase\b/i.test(lower)
      || /convert\s+(?:to\s+)?camel/i.test(lower)) return algoTemplate('to_camel_case', lang);
    // Snake case conversion (match the underscore form too)
    if (/\b(?:to\s+)?snake[\s_-]?case\b/i.test(lower)
      || /\bsnakecase\b/i.test(lower)
      || /convert\s+(?:to\s+)?snake/i.test(lower)) return algoTemplate('to_snake_case', lang);
    // Kebab case conversion
    if (/\b(?:to\s+)?kebab[\s-]?case\b/i.test(lower)
      || /\bkebabcase\b/i.test(lower)
      || /convert\s+(?:to\s+)?kebab/i.test(lower)) return algoTemplate('to_kebab_case', lang);
    // Capitalize string (after title-case — which is more specific)
    if (/\bcapitalize\s+(?:a\s+|the\s+)?string\b/i.test(lower)
      || /capitalize\s+(?:the\s+)?first\s+(?:letter|character)/i.test(lower)
      || /uppercase\s+(?:the\s+)?first\s+(?:letter|character)/i.test(lower)) return algoTemplate('capitalize', lang);
    // Count words
    if (/count\s+(?:the\s+|all\s+(?:the\s+)?)?words?\b/i.test(lower)
      || /\bword\s+count(?:er|ing)?\s+(?:function|method)/i.test(lower)
      || /how\s+many\s+words\s+in/i.test(lower)) return algoTemplate('word_count', lang);
    // Count characters (count_vowels matches earlier so this is safe)
    if (/count\s+(?:the\s+|all\s+(?:the\s+)?)?(?:characters?|chars?|letters?)\b/i.test(lower)
      || /character\s+count(?:er|ing)?\b/i.test(lower)
      || /how\s+many\s+(?:characters?|letters?)\s+in/i.test(lower)) return algoTemplate('char_count', lang);
    // Remove / collapse whitespace
    if (/(?:remove|strip)\s+(?:all\s+)?whitespace/i.test(lower)
      || /collapse\s+whitespace/i.test(lower)
      || /normalize\s+whitespace/i.test(lower)) return algoTemplate('remove_whitespace', lang);
    // Truncate string
    if (/truncate\s+(?:a\s+|the\s+)?(?:string|text)\b/i.test(lower)
      || /string\s+truncat(?:e|ion)/i.test(lower)
      || /(?:add|append)\s+(?:an\s+)?ellipsis/i.test(lower)) return algoTemplate('truncate_string', lang);

    // ─── ARRAY OPERATIONS ───
    // Chunk array
    if (/\bchunk\s+(?:an?\s+|the\s+)?(?:array|list)\b/i.test(lower)
      || /split\s+(?:an?\s+|the\s+)?(?:array|list)\s+into\s+chunks/i.test(lower)
      || /\b(?:array|list)\s+chunk\b/i.test(lower)) return algoTemplate('chunk_array', lang);
    // Unique / deduplicate array
    if (/\b(?:unique|dedup(?:e|licate)|deduplicate)\s+(?:values?\s+|elements?\s+|items?\s+)?(?:in\s+)?(?:an?\s+|the\s+)?(?:array|list)\b/i.test(lower)
      || /remove\s+dup(?:licate)?s?\s+(?:from\s+|in\s+)?(?:an?\s+|the\s+)?(?:array|list)/i.test(lower)
      || /\barray\s+of\s+unique\s+(?:values?|elements?|items?)/i.test(lower)) return algoTemplate('unique_array', lang);
    // Group by
    if (/\bgroup[\s-]?by\b/i.test(lower)
      || /group\s+(?:elements?|items?|an?\s+array|a\s+list)\s+by/i.test(lower)) return algoTemplate('group_by', lang);
    // Partition array
    if (/partition\s+(?:an?\s+|the\s+)?(?:array|list)\b/i.test(lower)
      || /\b(?:array|list)\s+partition\b/i.test(lower)
      || /split\s+(?:an?\s+|the\s+)?(?:array|list)\s+by\s+(?:a\s+)?predicate/i.test(lower)) return algoTemplate('partition_array', lang);
    // Zip arrays
    if (/\bzip\s+(?:two\s+|multiple\s+)?(?:arrays?|lists?)\b/i.test(lower)
      || /\b(?:array|list)\s+zip\b/i.test(lower)
      || /combine\s+two\s+(?:arrays?|lists?)\s+(?:pair|element).*wise/i.test(lower)) return algoTemplate('zip_arrays', lang);
    // Range / number range
    if (/\b(?:range|number\s+range)\s+(?:function|method|generator)\b/i.test(lower)
      || /generate\s+(?:a\s+)?range\s+of\s+numbers?/i.test(lower)
      || /(?:array|list)\s+of\s+numbers?\s+from\s+\w+\s+to\s+\w+/i.test(lower)) return algoTemplate('range_array', lang);
    // Flatten deep (after existing flatten_array which only handles one level)
    if (/flatten(?:s|ed|ing)?\s+(?:deep(?:ly)?|recursive(?:ly)?|completely|fully)/i.test(lower)
      || /deep(?:ly)?\s+flatten(?:s|ed|ing)?/i.test(lower)
      || /flatten(?:s|ed|ing)?\s+(?:a\s+|an?\s+)?(?:deep(?:ly)?|recursive(?:ly)?|completely|fully)\s+nested/i.test(lower)
      || /flatten(?:s|ed|ing)?\s+(?:a\s+|an?\s+)?nested\s+(?:array|list)\s+(?:deep(?:ly)?|recursive(?:ly)?|completely|fully)/i.test(lower)) return algoTemplate('flatten_deep', lang);
    // Array intersection
    if (/(?:array|set|list)\s+intersection/i.test(lower)
      || /intersect(?:ion)?\s+of\s+(?:two\s+|multiple\s+)?(?:arrays?|sets?|lists?)/i.test(lower)
      || /(?:common|shared)\s+(?:elements?|values?|items?)\s+(?:in|between)\s+(?:two\s+)?(?:arrays?|lists?)/i.test(lower)) return algoTemplate('intersection', lang);
    // Array union
    if (/(?:array|set|list)\s+union/i.test(lower)
      || /union\s+of\s+(?:two\s+|multiple\s+)?(?:arrays?|sets?|lists?)/i.test(lower)
      || /merge\s+(?:two\s+)?(?:arrays?|lists?)\s+without\s+dup(?:licate)?s?/i.test(lower)) return algoTemplate('union_arrays', lang);
    // Rotate array
    if (/rotate\s+(?:an?\s+|the\s+)?(?:array|list)/i.test(lower)
      || /\b(?:array|list)\s+rotate\b/i.test(lower)
      || /shift\s+(?:an?\s+|the\s+)?(?:array|list)\s+(?:elements?\s+)?(?:left|right|by)/i.test(lower)) return algoTemplate('rotate_array', lang);

    // ─── SORTING & SEARCHING (extended) ───
    if (/\bquick\s*sort\b/i.test(lower)) return algoTemplate('quicksort', lang);
    if (/\bheap\s*sort\b/i.test(lower)) return algoTemplate('heapsort', lang);
    if (/\bcounting\s*sort\b/i.test(lower)) return algoTemplate('counting_sort', lang);
    if (/\bradix\s*sort\b/i.test(lower)) return algoTemplate('radix_sort', lang);
    if (/\blinear\s*search\b/i.test(lower)) return algoTemplate('linear_search', lang);
    if (/\binterpolation\s*search\b/i.test(lower)) return algoTemplate('interpolation_search', lang);
    if (/(?:find|get)\s+(?:the\s+)?(?:min(?:imum)?|smallest)\s+(?:element\s+)?(?:in\s+)?(?:an?\s+)?array/i.test(lower)
      || /min(?:imum)?\s+(?:element\s+)?(?:in\s+|of\s+)(?:an?\s+)?array/i.test(lower)) return algoTemplate('find_min', lang);
    if (/sum\s+(?:of\s+)?(?:all\s+)?(?:elements?\s+|values?\s+)?(?:in\s+)?(?:an?\s+|the\s+)?array/i.test(lower)
      || /\barray\s+sum\b/i.test(lower)) return algoTemplate('sum_array', lang);
    if (/count\s+(?:the\s+)?occurrences?\s+of/i.test(lower)
      || /how\s+many\s+times\s+(?:does|is)\s+.+\s+(?:appear|occur)/i.test(lower)) return algoTemplate('count_occurrences', lang);

    // ─── DYNAMIC PROGRAMMING ───
    if (/\bcoin\s*change\b/i.test(lower)
      || /minimum\s+coins?\s+(?:to\s+)?(?:make|form)/i.test(lower)) return algoTemplate('coin_change', lang);
    if (/\bedit\s*distance\b/i.test(lower)
      || /\blevenshtein\s+distance\b/i.test(lower)) return algoTemplate('edit_distance', lang);
    if (/\blongest\s+common\s+subsequence\b/i.test(lower)
      || /\blcs\b/i.test(lower)) return algoTemplate('lcs', lang);
    if (/\bknapsack\b/i.test(lower)
      || /0[\/-]?1\s+knapsack/i.test(lower)) return algoTemplate('knapsack', lang);
    if (/\bkadane(?:'?s)?\s+(?:algorithm|method)\b/i.test(lower)
      || /maximum\s+sub[\s-]?array\s+sum/i.test(lower)
      || /max(?:imum)?\s+sub[\s-]?array\b/i.test(lower)) return algoTemplate('kadane_max_subarray', lang);
    if (/\blongest\s+increasing\s+subsequence\b/i.test(lower)
      || /\blis\b.*(?:subsequence|sequence|array)/i.test(lower)) return algoTemplate('longest_increasing_subseq', lang);
    if (/\bclimb(?:ing)?\s+stairs?\b/i.test(lower)
      || /stair[\s-]?case\s+problem/i.test(lower)) return algoTemplate('climb_stairs', lang);
    if (/\bhouse\s+robber\b/i.test(lower)) return algoTemplate('house_robber', lang);
    if (/unique\s+paths?\s+(?:in\s+)?(?:a\s+)?(?:grid|matrix)/i.test(lower)) return algoTemplate('unique_paths', lang);
    if (/fibonacci\s+(?:iterative(?:ly)?|with\s+(?:a\s+)?loop|using\s+(?:a\s+)?loop|bottom[\s-]?up|dp)/i.test(lower)
      || /iterative\s+fibonacci/i.test(lower)) return algoTemplate('fibonacci_iterative', lang);
    if (/fibonacci\s+(?:memoiz(?:ed|ation)|with\s+memo(?:ization)?|dp\s+memoiz)/i.test(lower)
      || /memoiz(?:ed|ation)\s+fibonacci/i.test(lower)) return algoTemplate('fibonacci_memo', lang);

    // ─── GRAPH ALGORITHMS ───
    if (/\b(?:bfs|breadth[\s-]?first\s+search)\b/i.test(lower)
      || /breadth[\s-]?first\s+traversal/i.test(lower)) return algoTemplate('bfs_graph', lang);
    if (/\b(?:dfs|depth[\s-]?first\s+search)\b/i.test(lower)
      || /depth[\s-]?first\s+traversal/i.test(lower)) return algoTemplate('dfs_graph', lang);
    if (/\bdijkstra(?:'?s)?\b/i.test(lower)
      || /shortest\s+path\s+(?:algorithm|in\s+(?:a\s+)?(?:weighted\s+)?graph)/i.test(lower)) return algoTemplate('dijkstra', lang);
    if (/\btopological\s+sort\b/i.test(lower)
      || /\btopo[\s-]?sort\b/i.test(lower)) return algoTemplate('topological_sort', lang);
    if (/detect\s+(?:a\s+)?cycle\s+(?:in\s+)?(?:an?\s+|the\s+)?(?:undirected\s+)?graph/i.test(lower)
      || /cycle\s+detection\s+(?:in\s+)?(?:an?\s+|the\s+)?graph/i.test(lower)) return algoTemplate('detect_cycle_graph', lang);
    if (/\bunion[\s-]?find\b/i.test(lower)
      || /\bdisjoint[\s-]?set(?:\s+(?:union|data\s+structure))?/i.test(lower)) return algoTemplate('union_find', lang);

    // ─── TREE ALGORITHMS ───
    if (/\bbst\s+search\b/i.test(lower)
      || /search\s+(?:in\s+)?(?:a\s+)?(?:binary\s+)?search\s+tree/i.test(lower)) return algoTemplate('bst_search', lang);
    if (/\b(?:in[\s-]?order)\s+(?:tree\s+)?traversal\b/i.test(lower)
      || /traverse\s+(?:a\s+)?tree\s+in[\s-]?order/i.test(lower)) return algoTemplate('tree_inorder', lang);
    if (/\b(?:pre[\s-]?order)\s+(?:tree\s+)?traversal\b/i.test(lower)
      || /traverse\s+(?:a\s+)?tree\s+pre[\s-]?order/i.test(lower)) return algoTemplate('tree_preorder', lang);
    if (/\b(?:post[\s-]?order)\s+(?:tree\s+)?traversal\b/i.test(lower)
      || /traverse\s+(?:a\s+)?tree\s+post[\s-]?order/i.test(lower)) return algoTemplate('tree_postorder', lang);
    if (/\b(?:level[\s-]?order)\s+(?:tree\s+)?traversal\b/i.test(lower)
      || /traverse\s+(?:a\s+)?tree\s+level[\s-]?order/i.test(lower)) return algoTemplate('tree_levelorder', lang);
    if (/(?:height|depth|max\s+depth)\s+of\s+(?:a\s+)?(?:binary\s+)?tree/i.test(lower)
      || /tree\s+height\b/i.test(lower)) return algoTemplate('tree_height', lang);
    if (/invert\s+(?:a\s+)?(?:binary\s+)?tree/i.test(lower)
      || /mirror\s+(?:a\s+)?(?:binary\s+)?tree/i.test(lower)) return algoTemplate('tree_invert', lang);
    if ((/(?:tree\s+)?path\s+sum\b/i.test(lower)
      || /sum\s+of\s+(?:a\s+)?path\s+in\s+(?:a\s+)?tree/i.test(lower))
      && !/\bmin(?:imum)?\s+(?:cost\s+)?path\s+sum\b/i.test(lower)
      && !/\bmax(?:imum)?\s+(?:cost\s+)?path\s+sum\b/i.test(lower)) return algoTemplate('tree_path_sum', lang);

    // ─── DATA STRUCTURES ───
    if (/\blru\s*cache\b/i.test(lower)
      || /least\s+recently\s+used\s+cache/i.test(lower)) return algoTemplate('lru_cache', lang);
    if (/\btrie\b/i.test(lower)
      || /\bprefix\s+tree\b/i.test(lower)) return algoTemplate('trie', lang);
    if (/\b(?:min|max)[\s-]*heap\b/i.test(lower)
      || /\bpriority\s+queue\b/i.test(lower)
      || /\b(?:binary\s+)?heap\b(?!\s*sort)/i.test(lower)) return algoTemplate('heap', lang);
    if (/\b(?:singly\s+)?linked\s+list\b/i.test(lower) && !/doubly|double/i.test(lower)) return algoTemplate('linked_list', lang);
    if (/\b(?:doubly|double)[\s-]+linked\s+list\b/i.test(lower)) return algoTemplate('doubly_linked_list', lang);
    if ((/\bdeque\b/i.test(lower)
      || /double[\s-]?ended\s+queue/i.test(lower))
      && !/\bmonotonic\b/i.test(lower)) return algoTemplate('deque', lang);

    // ─── STRING ALGORITHMS ───
    if (/\bkmp\b/i.test(lower)
      || /knuth[\s-]?morris[\s-]?pratt/i.test(lower)) return algoTemplate('kmp_search', lang);
    if (/\brabin[\s-]?karp\b/i.test(lower)) return algoTemplate('rabin_karp', lang);
    if (/\blevenshtein\b/i.test(lower) && !/distance/i.test(lower)) return algoTemplate('levenshtein', lang);
    if (/longest\s+common\s+substring/i.test(lower)) return algoTemplate('longest_common_substring', lang);
    if (/longest\s+palindromic?\s+substring/i.test(lower)) return algoTemplate('longest_palindrome_substring', lang);
    if (/\bz[\s-]?algorithm\b/i.test(lower)) return algoTemplate('z_algorithm', lang);
    if (/(?:check|detect)\s+(?:if\s+)?(?:one\s+|two\s+)?strings?\s+(?:is|are)\s+(?:a\s+)?rotations?/i.test(lower)
      || /string\s+rotations?\s+check/i.test(lower)
      || /\bstrings?\s+are\s+rotations?\b/i.test(lower)) return algoTemplate('string_rotation_check', lang);

    // ─── UTILITY FUNCTIONS (functional / async) ───
    if (/\bdebounce\b/i.test(lower)) return algoTemplate('debounce', lang);
    if (/\bthrottle\b/i.test(lower)) return algoTemplate('throttle', lang);
    if (/\bdeep\s*clone\b/i.test(lower)
      || /clone\s+(?:a\s+|an\s+)?object\s+deep(?:ly)?/i.test(lower)) return algoTemplate('deep_clone', lang);
    if (/\bdeep\s*equal\b/i.test(lower)
      || /deep(?:ly)?\s+compare\s+(?:two\s+)?(?:objects?|values?)/i.test(lower)) return algoTemplate('deep_equal', lang);
    if (/\bmemoize\b/i.test(lower)
      || /memoization\s+(?:function|helper|wrapper)/i.test(lower)) return algoTemplate('memoize', lang);
    if (/\bcurry\b/i.test(lower)
      || /curry(?:ing)?\s+(?:a\s+)?function/i.test(lower)) return algoTemplate('curry', lang);
    if (/\bcompose\s+(?:functions?|fns?)\b/i.test(lower)
      || /function\s+composition\b/i.test(lower)) return algoTemplate('compose', lang);
    if (/\bpipe\s+(?:functions?|fns?)\b/i.test(lower)) return algoTemplate('pipe', lang);
    if (/\bonce\s+(?:function|helper|wrapper)\b/i.test(lower)
      || /(?:ensure|make)\s+(?:a\s+)?function\s+(?:only\s+)?runs?\s+once/i.test(lower)) return algoTemplate('once', lang);
    if (/retry\s+with\s+(?:exponential\s+)?backoff/i.test(lower)
      || /\bexponential\s+backoff\b/i.test(lower)) return algoTemplate('retry_backoff', lang);

    // ─── NUMERIC / MATH ───
    if (/\bdigit\s+sum\b/i.test(lower)
      || /sum\s+of\s+digits\b/i.test(lower)) return algoTemplate('digit_sum', lang);
    if (/reverse\s+(?:an?\s+)?integer\b/i.test(lower)
      || /\binteger\s+revers(?:al|e)\b/i.test(lower)) return algoTemplate('reverse_integer', lang);
    if (/(?:is\s+|check\s+(?:if\s+)?)(?:a\s+)?power\s+of\s+(?:two|2)\b/i.test(lower)
      || /\bis\s*power\s*of\s*two\b/i.test(lower)) return algoTemplate('is_power_of_two', lang);
    if (/\bfast\s+(?:exponentiation|power)\b/i.test(lower)
      || /binary\s+exponentiation\b/i.test(lower)
      || /power\s+iterative\b/i.test(lower)) return algoTemplate('fast_power', lang);
    if (/prime\s+factoriz(?:e|ation)/i.test(lower)
      || /factoriz(?:e|ation)\s+(?:of\s+)?(?:a\s+)?(?:number|integer)/i.test(lower)) return algoTemplate('prime_factorization', lang);
    if (/factorial\s+(?:iterative(?:ly)?|with\s+(?:a\s+)?loop|using\s+(?:a\s+)?loop)/i.test(lower)
      || /iterative\s+factorial/i.test(lower)) return algoTemplate('factorial_iterative', lang);
    if (/\bnth\s+prime\b/i.test(lower)
      || /(?:find|get)\s+the\s+nth\s+prime/i.test(lower)) return algoTemplate('nth_prime', lang);
    if (/\bcombinations?\s+(?:of|function|method)\b/i.test(lower)
      || /\bn\s*choose\s*k\b/i.test(lower)
      || /\bbinomial\s+coefficient\b/i.test(lower)) return algoTemplate('combinations', lang);
    if (/\bpermutations?\s+(?:of|function|method|generator)\b/i.test(lower)
      || /generate\s+(?:all\s+)?permutations?/i.test(lower)) return algoTemplate('permutations', lang);
    if (/pascal(?:'?s)?\s+triangle/i.test(lower)) return algoTemplate('pascal_triangle', lang);

    // ─── STATISTICS ───
    if (/(?:compute|calculate|find)\s+(?:the\s+)?(?:mean|average)\s+of/i.test(lower)
      || /\b(?:mean|average)\s+of\s+(?:an?\s+)?(?:array|list|numbers?)/i.test(lower)) return algoTemplate('average_array', lang);
    if (/(?:compute|calculate|find)\s+(?:the\s+)?median/i.test(lower)
      || /\bmedian\s+of\s+(?:an?\s+)?(?:array|list|numbers?)/i.test(lower)) return algoTemplate('median', lang);
    if (/(?:compute|calculate|find)\s+(?:the\s+)?mode\s+of/i.test(lower)
      || /\bmode\s+of\s+(?:an?\s+)?(?:array|list|numbers?)/i.test(lower)) return algoTemplate('mode', lang);
    if (/(?:compute|calculate|find)\s+(?:the\s+)?\bvariance\b/i.test(lower)
      || /\bvariance\s+of\s+(?:an?\s+)?(?:array|list|numbers?)/i.test(lower)) return algoTemplate('variance', lang);
    if (/(?:compute|calculate|find)\s+(?:the\s+)?(?:standard\s+deviation|std\s*dev|stddev)/i.test(lower)
      || /\b(?:standard\s+deviation|std\s*dev|stddev)\s+of/i.test(lower)) return algoTemplate('stddev', lang);
    if (/\barmstrong\s+number\b/i.test(lower)
      || /narcissistic\s+number/i.test(lower)) return algoTemplate('is_armstrong', lang);

    // ─── BATCH 2: BIT MANIPULATION & NUMBER THEORY ───
    if (/\bcount\s+set\s+bits?\b/i.test(lower)
      || /\bnumber\s+of\s+(?:set\s+)?(?:one\s+)?bits?\b/i.test(lower)
      || /\bhamming\s+weight\b/i.test(lower)
      || /\bpop(?:ulation)?\s*count\b/i.test(lower)) return algoTemplate('count_set_bits', lang);
    if (/\bhamming\s+distance\b/i.test(lower)) return algoTemplate('hamming_distance', lang);
    if (/single\s+number\s+(?:problem|in\s+(?:an?\s+)?array)/i.test(lower)
      || /find\s+the\s+(?:only\s+)?(?:element|number)\s+that\s+appears\s+once/i.test(lower)
      || /\bxor\s+trick\b/i.test(lower)) return algoTemplate('single_number', lang);
    if (/\bmissing\s+number\s+(?:in\s+)?(?:an?\s+)?(?:array|list|range)/i.test(lower)) return algoTemplate('missing_number', lang);
    if (/\bgray\s+code\b/i.test(lower)) return algoTemplate('gray_code', lang);
    if (/\bpower\s+of\s+(?:four|4)\b/i.test(lower)
      || /\bis\s+power\s+of\s+(?:four|4)\b/i.test(lower)) return algoTemplate('power_of_four', lang);
    if (/\bnext\s+power\s+of\s+(?:two|2)\b/i.test(lower)
      || /\bround\s+up\s+to\s+(?:a\s+)?power\s+of\s+(?:two|2)\b/i.test(lower)) return algoTemplate('next_power_of_two', lang);
    if (/\bextended\s+(?:euclidean|gcd)\b/i.test(lower)
      || /\bbezout(?:'?s)?\s+(?:coefficients?|identity)\b/i.test(lower)) return algoTemplate('extended_gcd', lang);
    if (/\b(?:iterative|euclidean)\s+gcd\b/i.test(lower)
      || /\bgcd\s+iterative\b/i.test(lower)
      || /\beuclidean\s+algorithm\b/i.test(lower)) return algoTemplate('gcd_iterative', lang);
    if (/\bmodular?\s+exponentiation\b/i.test(lower)
      || /\bmod(?:ular)?\s+(?:fast\s+)?pow(?:er)?\b/i.test(lower)
      || /\bpow\s*\(\s*base\s*,\s*exp\s*,\s*mod/i.test(lower)) return algoTemplate('mod_pow', lang);
    if (/\beuler(?:'?s)?\s+totient\b/i.test(lower)
      || /\bphi\s+function\b/i.test(lower)) return algoTemplate('euler_totient', lang);
    if (/\binteger\s+(?:square\s+root|sqrt)\b/i.test(lower)
      || /\bisqrt\b/i.test(lower)
      || /\bbabylonian\s+(?:method|sqrt)\b/i.test(lower)) return algoTemplate('integer_sqrt', lang);
    if (/\btwo\s+sum\b/i.test(lower)
      || /\b2\s*sum\b/i.test(lower)) return algoTemplate('two_sum', lang);
    if (/\bthree\s+sum\b/i.test(lower)
      || /\b3\s*sum\b/i.test(lower)) return algoTemplate('three_sum', lang);

    // ─── BATCH 3: ADVANCED DP & BACKTRACKING ───
    if (/\bmatrix\s+chain\s+multiplication\b/i.test(lower)
      || /\boptimal\s+matrix\s+parenthesiz(?:e|ation)\b/i.test(lower)) return algoTemplate('matrix_chain', lang);
    if (/\bpalindrome\s+partition(?:ing)?\b/i.test(lower)
      || /\bmin(?:imum)?\s+cuts?\s+for\s+palindrome\b/i.test(lower)) return algoTemplate('palindrome_partition', lang);
    if (/\bword\s+break\b/i.test(lower)
      || /segment\s+(?:a\s+)?string\s+into\s+dictionary\s+words/i.test(lower)) return algoTemplate('word_break', lang);
    if (/\bregex(?:\s+|ular\s+expression\s+)match(?:ing)?\b/i.test(lower)
      || /\bregular\s+expression\s+matching\b/i.test(lower)) return algoTemplate('regex_match', lang);
    if (/\bwildcard\s+match(?:ing)?\b/i.test(lower)) return algoTemplate('wildcard_match', lang);
    if (/\bmin(?:imum)?\s+path\s+sum\b/i.test(lower)
      || /\bmin(?:imum)?\s+cost\s+path\s+in\s+(?:a\s+)?(?:grid|matrix)\b/i.test(lower)) return algoTemplate('min_path_sum', lang);
    if (/\brod\s+cutting\b/i.test(lower)) return algoTemplate('rod_cutting', lang);
    if (/\bsubset\s+sum\b/i.test(lower)
      || /partition\s+(?:an?\s+)?array\s+into\s+(?:two\s+)?(?:equal\s+)?(?:sum|subsets?)/i.test(lower)) return algoTemplate('subset_sum', lang);
    if (/\bdecode\s+ways\b/i.test(lower)
      || /number\s+of\s+ways\s+to\s+decode\s+a\s+string/i.test(lower)) return algoTemplate('decode_ways', lang);
    if (/\bjump\s+game\b/i.test(lower)) return algoTemplate('jump_game', lang);
    if (/\bn[\s-]?queens?\b/i.test(lower)
      || /\b(?:eight|8)\s+queens?\s+problem\b/i.test(lower)) return algoTemplate('n_queens', lang);
    if (/\bsudoku\s+solver\b/i.test(lower)
      || /solve\s+(?:a\s+)?sudoku/i.test(lower)) return algoTemplate('sudoku_solver', lang);
    if (/\bgenerate\s+parentheses\b/i.test(lower)
      || /\bvalid\s+parentheses\s+combinations?\b/i.test(lower)) return algoTemplate('generate_parentheses', lang);
    if (/\bgenerate\s+(?:all\s+)?subsets\b/i.test(lower)
      || /\b(?:return|returns|produce|produces|get|list|all)\s+(?:all\s+)?(?:the\s+)?subsets\s+of\b/i.test(lower)
      || /\ball\s+subsets\s+of\b/i.test(lower)
      || /\bpower\s*set\b/i.test(lower)) return algoTemplate('subsets', lang);
    if (/\bcombination\s+sum\b/i.test(lower)
      || /find\s+all\s+combinations\s+(?:that\s+)?sum\s+to/i.test(lower)) return algoTemplate('combination_sum', lang);

    // ─── BATCH 4: ADVANCED GRAPHS & GEOMETRY ───
    if (/\bbellman[\s-]?ford\b/i.test(lower)
      || /shortest\s+path\s+with\s+negative\s+(?:edges|weights)/i.test(lower)) return algoTemplate('bellman_ford', lang);
    if (/\bfloyd[\s-]?warshall\b/i.test(lower)
      || /\ball[\s-]?pairs?\s+shortest\s+paths?\b/i.test(lower)) return algoTemplate('floyd_warshall', lang);
    if (/\bkruskal(?:'?s)?\s+(?:algorithm|mst)\b/i.test(lower)
      || /\bkruskal\b/i.test(lower)) return algoTemplate('kruskal_mst', lang);
    if (/\bprim(?:'?s)?\s+(?:algorithm|mst)\b/i.test(lower)) return algoTemplate('prim_mst', lang);
    if (/\ba[\s-]?star\s+(?:search|algorithm|pathfinding)?\b/i.test(lower)
      || /\bheuristic\s+search\s+algorithm\b/i.test(lower)) return algoTemplate('a_star', lang);
    if (/\bmax(?:imum)?\s+flow\b/i.test(lower)
      || /\bford[\s-]?fulkerson\b/i.test(lower)
      || /\bedmonds[\s-]?karp\b/i.test(lower)) return algoTemplate('max_flow', lang);
    if (/\btarjan(?:'?s)?\s+(?:algorithm|scc)\b/i.test(lower)
      || /\bstrongly\s+connected\s+components?\b/i.test(lower)) return algoTemplate('tarjan_scc', lang);
    if (/\barticulation\s+points?\b/i.test(lower)
      || /\bcut\s+vertices?\b/i.test(lower)
      || /\bbridges?\s+in\s+(?:a\s+)?graph\b/i.test(lower)) return algoTemplate('articulation_points', lang);
    if (/\bconvex\s+hull\b/i.test(lower)
      || /\bgraham\s+scan\b/i.test(lower)
      || /\bandrew(?:'?s)?\s+monotone\s+chain\b/i.test(lower)) return algoTemplate('convex_hull', lang);
    if (/\bline\s+(?:segment\s+)?intersection\b/i.test(lower)
      || /\bsegments?\s+intersect\b/i.test(lower)) return algoTemplate('line_intersection', lang);
    if (/\bpolygon\s+area\b/i.test(lower)
      || /\bshoelace\s+(?:formula|algorithm)\b/i.test(lower)) return algoTemplate('polygon_area', lang);
    if (/\b(?:euclidean\s+)?(?:point|distance)\s+between\s+(?:two\s+)?points\b/i.test(lower)
      || /\bdistance\s+formula\b/i.test(lower)) return algoTemplate('point_distance', lang);

    // ─── BATCH 5: ADVANCED DATA STRUCTURES ───
    if (/\bsegment\s+tree\b/i.test(lower)) return algoTemplate('segment_tree', lang);
    if (/\b(?:fenwick\s+tree|binary\s+indexed\s+tree|bit)\b/i.test(lower)
      && /(?:implement|write|create|build|make)\s+(?:a\s+)?(?:fenwick|binary\s+indexed|bit)/i.test(lower)) return algoTemplate('fenwick_tree', lang);
    if (/\bsparse\s+table\b/i.test(lower)) return algoTemplate('sparse_table', lang);
    if (/\bmonotonic\s+stack\b/i.test(lower)
      || /\b(?:next|previous)\s+greater\s+element\b/i.test(lower)) return algoTemplate('monotonic_stack', lang);
    if (/\bmonotonic\s+(?:queue|deque)\b/i.test(lower)
      || /\bsliding\s+window\s+max(?:imum)?\b/i.test(lower)) return algoTemplate('monotonic_queue', lang);
    if (/\bsuffix\s+array\b/i.test(lower)) return algoTemplate('suffix_array', lang);
    if (/\bbloom\s+filter\b/i.test(lower)) return algoTemplate('bloom_filter', lang);
    if (/\bskip\s+list\b/i.test(lower)) return algoTemplate('skip_list', lang);
    if (/\bcircular\s+buffer\b/i.test(lower)
      || /\bring\s+buffer\b/i.test(lower)) return algoTemplate('circular_buffer', lang);
    if (/\bdisjoint[\s-]?set\s+forest\b/i.test(lower)) return algoTemplate('disjoint_set_forest', lang);

    // ─── BATCH 6: WEB / DEV UTILITIES ───
    if (/\bparse\s+(?:a\s+)?url\b/i.test(lower)
      || /\burl\s+parse(?:r)?\b/i.test(lower)) return algoTemplate('parse_url', lang);
    if (/\bbuild\s+(?:a\s+)?query\s+string\b/i.test(lower)
      || /\bserialize\s+(?:an?\s+)?object\s+(?:in)?to\s+(?:a\s+)?query\s+string\b/i.test(lower)
      || /\b(?:object|params)\s+to\s+query\s+string\b/i.test(lower)) return algoTemplate('build_query_string', lang);
    if (/\bescape\s+html\b/i.test(lower)
      || /\bhtml\s+escape\b/i.test(lower)
      || /\bsanitize\s+html\s+entities\b/i.test(lower)) return algoTemplate('escape_html', lang);
    if (/\burl\s+encode\b/i.test(lower)
      || /\bpercent[\s-]?encode\b/i.test(lower)) return algoTemplate('url_encode', lang);
    if (/\bbase64\s+encode\b/i.test(lower)
      || /\bencode\s+(?:a\s+)?(?:string|bytes)\s+(?:to|as)\s+base64\b/i.test(lower)) return algoTemplate('base64_encode', lang);
    if (/\bmd5\b/i.test(lower)
      && /(?:hash|implement|write|compute|calculate)/i.test(lower)) return algoTemplate('md5_hash', lang);
    if (/\bsha[\s-]?256\b/i.test(lower)
      && /(?:hash|implement|write|compute|calculate)/i.test(lower)) return algoTemplate('sha256_hash', lang);
    if (/\b(?:constant[\s-]?time|timing[\s-]?safe|safe)\s+(?:string\s+)?compare\b/i.test(lower)
      || /\btiming\s+attack\s+safe\b/i.test(lower)) return algoTemplate('safe_compare', lang);
    if (/\buuid\s*(?:v?4)?\b/i.test(lower)
      && /(?:generate|create|make|random)/i.test(lower)) return algoTemplate('uuid_v4', lang);
    if (/\bvalidate\s+(?:an?\s+)?e[\s-]?mail\b/i.test(lower)
      || /\bis\s+(?:valid\s+)?email\b/i.test(lower)
      || /\bemail\s+(?:address\s+)?regex\b/i.test(lower)) return algoTemplate('validate_email', lang);
    if (/\bvalidate\s+(?:a\s+)?phone\s+number\b/i.test(lower)
      || /\bis\s+(?:valid\s+)?phone\s+number\b/i.test(lower)) return algoTemplate('validate_phone', lang);
    if (/\bformat\s+(?:a\s+)?(?:number\s+as\s+)?currency\b/i.test(lower)
      || /\bcurrency\s+formatter\b/i.test(lower)) return algoTemplate('format_currency', lang);
    if (/\bformat\s+(?:file\s+)?(?:bytes?|size)\b/i.test(lower)
      || /\bhuman[\s-]?readable\s+(?:file\s+)?size\b/i.test(lower)) return algoTemplate('format_bytes', lang);
    if (/\bmask\s+(?:a\s+)?credit\s+card\b/i.test(lower)
      || /\bredact\s+credit\s+card\b/i.test(lower)) return algoTemplate('mask_credit_card', lang);
    if (/\bparse\s+(?:a\s+)?cookies?\b/i.test(lower)
      || /\bcookie\s+parser\b/i.test(lower)) return algoTemplate('parse_cookies', lang);

    // ─── BATCH 7: DATE/TIME & I/O ───
    if (/\bformat\s+(?:a\s+)?date\b/i.test(lower)
      && !/\biso\s*8601\b/i.test(lower)) return algoTemplate('format_date', lang);
    if (/\bparse\s+iso\s*8601\b/i.test(lower)
      || /\biso\s*8601\s+parser\b/i.test(lower)) return algoTemplate('parse_iso8601', lang);
    if (/\bdate\s+diff(?:erence)?\b/i.test(lower)
      || /\bdays?\s+between\s+(?:two\s+)?dates?\b/i.test(lower)) return algoTemplate('date_diff_days', lang);
    if (/\bis\s+leap\s+year\b/i.test(lower)
      || /\bleap\s+year\s+check\b/i.test(lower)) return algoTemplate('is_leap_year', lang);
    if (/\bday\s+of\s+(?:the\s+)?week\b/i.test(lower)
      || /\bzeller(?:'?s)?\s+congruence\b/i.test(lower)) return algoTemplate('day_of_week', lang);
    if (/\bformat\s+(?:a\s+)?duration\b/i.test(lower)
      || /\bseconds\s+to\s+(?:human\s+)?(?:readable\s+)?(?:time|duration)\b/i.test(lower)) return algoTemplate('format_duration', lang);
    if (/\bread\s+(?:a\s+)?csv\b/i.test(lower)
      || /\bcsv\s+reader?\b/i.test(lower)
      || /\bparse\s+(?:a\s+)?csv\b/i.test(lower)) return algoTemplate('read_csv', lang);
    if (/\bwrite\s+(?:a\s+)?csv\b/i.test(lower)
      || /\bcsv\s+writer?\b/i.test(lower)) return algoTemplate('write_csv', lang);
    if (/\bwalk\s+(?:a\s+)?director(?:y|ies)\b/i.test(lower)
      || /\brecursive\s+file\s+(?:listing|walk)\b/i.test(lower)) return algoTemplate('walk_directory', lang);
    if (/\bstream\s+file\s+lines?\b/i.test(lower)
      || /\bread\s+(?:a\s+)?(?:large\s+)?file\s+line\s+by\s+line\b/i.test(lower)) return algoTemplate('stream_file_lines', lang);

    // ─── BATCH 8: ASYNC PATTERNS ───
    if (/\b(?:async\s+)?sleep\s+function\b/i.test(lower)
      || /\b(?:implement|write)\s+(?:a\s+)?sleep\b/i.test(lower)
      || /\bdelay\s+function\b/i.test(lower)) return algoTemplate('sleep', lang);
    if (/\bpromise\s+pool\b/i.test(lower)
      || /\blimit\s+(?:parallel\s+)?promises\b/i.test(lower)
      || /\bconcurrency\s+limit(?:er)?\b/i.test(lower)) return algoTemplate('promise_pool', lang);
    if (/\b(?:race|timeout)\s+(?:with\s+)?(?:a\s+)?timeout\b/i.test(lower)
      || /\bpromise\s+with\s+timeout\b/i.test(lower)) return algoTemplate('race_timeout', lang);
    if (/\basync\s+queue\b/i.test(lower)
      || /\btask\s+queue\b/i.test(lower)) return algoTemplate('async_queue', lang);
    if (/\bevent\s+emitter\b/i.test(lower)
      || /\bpub(?:lish)?[\s-]?sub(?:scribe)?\s+(?:class|implementation)\b/i.test(lower)) return algoTemplate('event_emitter', lang);
    if (/\bsliding\s+window\s+(?:iterator|generator|function)\b/i.test(lower)
      || /\bsliding\s+window\s+of\s+(?:size\s+)?\w+\s+over/i.test(lower)) return algoTemplate('sliding_window', lang);
    if (/\bpairwise\s+(?:iterator|generator)\b/i.test(lower)
      || /\biterate\s+(?:an?\s+)?array\s+pairwise\b/i.test(lower)) return algoTemplate('pairwise', lang);
    if (/\bgenerator\s+chain\b/i.test(lower)
      || /\bchain\s+(?:iterators?|generators?)\b/i.test(lower)) return algoTemplate('generator_chain', lang);
    if (/\bbatch\s+async\s+(?:requests?|calls?|operations?)\b/i.test(lower)
      || /\basync\s+batch\s+processor\b/i.test(lower)) return algoTemplate('batch_async', lang);
    if (/\bcancellable\s+fetch\b/i.test(lower)
      || /\babort(?:able)?\s+fetch\b/i.test(lower)) return algoTemplate('cancellable_fetch', lang);

    // ─── BATCH 9: STATS & ML BASICS ───
    if (/\bpercentile\b/i.test(lower)
      && /(?:compute|calculate|find|function)/i.test(lower)) return algoTemplate('percentile', lang);
    if (/\bmoving\s+average\b/i.test(lower)
      && !/\bexponential\b/i.test(lower)) return algoTemplate('moving_average', lang);
    if (/\bexponential\s+moving\s+average\b/i.test(lower)
      || /\bema\s+calculation\b/i.test(lower)) return algoTemplate('ema', lang);
    if (/\bz[\s-]?score\b/i.test(lower)
      || /\bstandard\s+score\b/i.test(lower)) return algoTemplate('zscore', lang);
    if (/\b(?:pearson\s+)?correlation\s+coefficient\b/i.test(lower)
      || /\bcorrelation\b.*\b(?:function|compute|calculate)\b/i.test(lower)) return algoTemplate('correlation', lang);
    if (/\bcovariance\b/i.test(lower)
      && /(?:compute|calculate|function)/i.test(lower)) return algoTemplate('covariance', lang);
    if (/\blinear\s+regression\b/i.test(lower)
      || /\bleast\s+squares?\s+fit\b/i.test(lower)
      || /\bordinary\s+least\s+squares?\b/i.test(lower)) return algoTemplate('linear_regression', lang);
    if (/\bk[\s-]?means\b/i.test(lower)) return algoTemplate('k_means', lang);
    if (/\bcosine\s+similarity\b/i.test(lower)) return algoTemplate('cosine_similarity', lang);
    if (/\beuclidean\s+distance\b/i.test(lower)
      && !/\bpoint\b/i.test(lower)) return algoTemplate('euclidean_distance', lang);
    if (/\bsoftmax\b/i.test(lower)) return algoTemplate('softmax', lang);
    if (/\bmatrix\s+multiplication\b/i.test(lower)
      || /\bmultiply\s+(?:two\s+)?matric(?:es|s)\b/i.test(lower)) return algoTemplate('matrix_multiply', lang);

    // ─── BATCH 10: POWER TOOLS ───
    if (/\brate\s+limit(?:er)?\b/i.test(lower)
      || /\btoken\s+bucket\b/i.test(lower)
      || /\bleaky\s+bucket\b/i.test(lower)) return algoTemplate('rate_limiter', lang);
    if (/\bcircuit\s+breaker\b/i.test(lower)) return algoTemplate('circuit_breaker', lang);
    if (/\blru\s+(?:cache\s+)?with\s+(?:a\s+)?ttl\b/i.test(lower)
      || /\btime[\s-]?to[\s-]?live\s+cache\b/i.test(lower)) return algoTemplate('lru_with_ttl', lang);
    if (/\b(?:finite\s+)?state\s+machine\b/i.test(lower)
      || /\bfsm\s+(?:implementation|class|pattern)\b/i.test(lower)) return algoTemplate('state_machine', lang);
    if (/\bpub(?:lish)?[\s-]?sub(?:scribe)?\s+pattern\b/i.test(lower)
      || /\bobserver\s+pattern\b/i.test(lower)) return algoTemplate('pub_sub', lang);
    if (/\bbinary\s+search\s+(?:for\s+)?(?:the\s+)?first\s+occurrence\b/i.test(lower)
      || /\blower\s+bound\s+binary\s+search\b/i.test(lower)) return algoTemplate('binary_search_first', lang);
    if (/\bbinary\s+search\s+(?:for\s+)?(?:the\s+)?last\s+occurrence\b/i.test(lower)
      || /\bupper\s+bound\s+binary\s+search\b/i.test(lower)) return algoTemplate('binary_search_last', lang);
    if (/\bquickselect\b/i.test(lower)
      || /\bkth\s+(?:smallest|largest)\s+element\b/i.test(lower)) return algoTemplate('quickselect', lang);
    if (/\btop[\s-]?k\s+frequent\b/i.test(lower)) return algoTemplate('top_k_frequent', lang);
    if (/\btop[\s-]?k\s+(?:largest|smallest)\b/i.test(lower)
      || /\bk\s+largest\s+elements?\b/i.test(lower)) return algoTemplate('top_k_largest', lang);

    return null;
}
