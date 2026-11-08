#include "selftest.h"

#include <algorithm>
#include <cmath>
#include <numeric>
#include <ostream>
#include <random>
#include <set>

#include "mathparser.h"

namespace bf {

namespace {

struct Suite {
    std::ostream& out;
    int checks = 0;
    int failures = 0;

    void check(bool condition, const std::string& name) {
        ++checks;
        if (!condition) {
            ++failures;
            out << "FAIL  " << name << "\n";
        }
    }
    void section(const std::string& title, int failuresBefore, int checksBefore) {
        out << (failures == failuresBefore ? "PASS  " : "FAIL  ") << title << " (" << (checks - checksBefore) << " checks)\n";
    }
};

Json arrayOf(const std::vector<int>& v) { return Json::fromVector(v); }

std::vector<int> toInts(const Json& j) {
    std::vector<int> out;
    for (const Json& v : j.items()) out.push_back(static_cast<int>(v.asInt()));
    return out;
}

Json runTraced(const Algorithm& a, const Json& input, StepRecorder& rec) { return a.run(input, rec); }

long long countType(const std::vector<ExecutionStep>& steps, const std::string& type) {
    return std::count_if(steps.begin(), steps.end(), [&](const ExecutionStep& s) { return s.type == type; });
}

bool stepsWellFormed(const std::vector<ExecutionStep>& steps) {
    if (steps.empty()) return false;
    for (std::size_t i = 0; i < steps.size(); ++i) {
        if (steps[i].index != static_cast<int>(i) || steps[i].type.empty() || !steps[i].data.isObject()) return false;
        if (!Json::parse(steps[i].toJson().dump()).isObject()) return false;
    }
    return true;
}

void testSorting(const AlgorithmManager& m, Suite& s) {
    int f = s.failures, c = s.checks;
    std::mt19937 rng(7);
    for (const char* id : {"bubble_sort", "selection_sort", "insertion_sort", "merge_sort", "quick_sort", "heap_sort"}) {
        const Algorithm* algo = m.find(id);
        s.check(algo != nullptr, std::string(id) + " registered");
        if (!algo) continue;
        for (int trial = 0; trial < 120; ++trial) {
            std::size_t n = 1 + rng() % 40;
            std::vector<int> v(n);
            for (int& x : v) x = static_cast<int>(rng() % 41) - 20;
            if (trial % 10 == 0) std::sort(v.begin(), v.end());
            if (trial % 10 == 1) std::sort(v.rbegin(), v.rend());
            Json input = Json::object({{"array", arrayOf(v)}});
            s.check(algo->validate(input).ok, std::string(id) + " accepts valid input");
            StepRecorder rec(true);
            Json result = runTraced(*algo, input, rec);
            std::vector<int> expected = v;
            std::sort(expected.begin(), expected.end());
            s.check(toInts(result["sorted"]) == expected, std::string(id) + " sorts correctly");
            s.check(stepsWellFormed(rec.steps()), std::string(id) + " steps are well formed");
            s.check(countType(rec.steps(), "compare") == rec.stats().comparisons, std::string(id) + " compare events match counter");
            s.check(countType(rec.steps(), "swap") == rec.stats().swaps, std::string(id) + " swap events match counter");
            s.check(countType(rec.steps(), "set") == rec.stats().writes, std::string(id) + " write events match counter");
            s.check(rec.steps().back().type == "done", std::string(id) + " ends with done");
            StepRecorder quiet(false);
            algo->run(input, quiet);
            s.check(quiet.stats().operations == rec.stats().operations, std::string(id) + " tracing does not change statistics");
        }
    }
    s.section("Sorting algorithms vs std::sort", f, c);
}

void testSearching(const AlgorithmManager& m, Suite& s) {
    int f = s.failures, c = s.checks;
    std::mt19937 rng(11);
    for (const char* id : {"linear_search", "binary_search", "jump_search"}) {
        const Algorithm* algo = m.find(id);
        s.check(algo != nullptr, std::string(id) + " registered");
        if (!algo) continue;
        for (int trial = 0; trial < 300; ++trial) {
            std::size_t n = 1 + rng() % 64;
            std::vector<int> v(n);
            for (int& x : v) x = static_cast<int>(rng() % 120) - 60;
            std::sort(v.begin(), v.end());
            int target = (trial % 2 == 0) ? v[rng() % n] : static_cast<int>(rng() % 160) - 80;
            Json input = Json::object({{"array", arrayOf(v)}, {"target", target}});
            s.check(algo->validate(input).ok, std::string(id) + " accepts valid input");
            StepRecorder rec(true);
            Json result = runTraced(*algo, input, rec);
            bool present = std::binary_search(v.begin(), v.end(), target);
            s.check(result["found"].asBool() == present, std::string(id) + " found flag");
            if (present) {
                long long idx = result["index"].asInt(-1);
                s.check(idx >= 0 && idx < static_cast<long long>(n) && v[static_cast<std::size_t>(idx)] == target,
                        std::string(id) + " returned index holds target");
                if (std::string(id) == "linear_search")
                    s.check(idx == std::find(v.begin(), v.end(), target) - v.begin(), "linear search returns first match");
            } else {
                s.check(result["index"].asInt(0) == -1, std::string(id) + " returns -1 when missing");
            }
            s.check(stepsWellFormed(rec.steps()), std::string(id) + " steps are well formed");
            s.check(countType(rec.steps(), "compare") == rec.stats().comparisons, std::string(id) + " compare events match counter");
        }
    }
    const Algorithm* binary = m.find("binary_search");
    s.check(binary && !binary->validate(Json::object({{"array", Json::array({5, 1, 3})}, {"target", 1}})).ok,
            "binary search rejects unsorted input");
    const Algorithm* jump = m.find("jump_search");
    s.check(jump && !jump->validate(Json::object({{"array", Json::array({5, 1, 3})}, {"target", 1}})).ok,
            "jump search rejects unsorted input");
    s.section("Searching algorithms vs std::binary_search", f, c);
}

std::vector<long long> referenceDistances(int n, const std::vector<GraphEdge>& edges, bool directed, int start) {
    const long long INF = 1LL << 50;
    std::vector<long long> d(static_cast<std::size_t>(n), INF);
    d[static_cast<std::size_t>(start)] = 0;
    for (int round = 0; round < n; ++round)
        for (const GraphEdge& e : edges) {
            auto relax = [&](int a, int b) {
                if (d[static_cast<std::size_t>(a)] < INF && d[static_cast<std::size_t>(a)] + e.weight < d[static_cast<std::size_t>(b)])
                    d[static_cast<std::size_t>(b)] = d[static_cast<std::size_t>(a)] + e.weight;
            };
            relax(e.from, e.to);
            if (!directed) relax(e.to, e.from);
        }
    for (long long& v : d)
        if (v >= INF) v = -1;
    return d;
}

void testGraph(const AlgorithmManager& m, Suite& s) {
    int f = s.failures, c = s.checks;
    std::mt19937 rng(23);
    const Algorithm* bfs = m.find("bfs");
    const Algorithm* dfs = m.find("dfs");
    const Algorithm* dij = m.find("dijkstra");
    s.check(bfs && dfs && dij, "graph algorithms registered");
    if (!bfs || !dfs || !dij) return;

    {
        StepRecorder rec(true);
        Json r = runTraced(*bfs, bfs->defaultInput(), rec);
        s.check(toInts(r["order"]) == std::vector<int>({0, 1, 2, 3, 4, 5}), "BFS order on the default graph");
        StepRecorder rec2(true);
        Json d = runTraced(*dfs, dfs->defaultInput(), rec2);
        s.check(toInts(d["order"]) == std::vector<int>({0, 1, 2, 4, 3, 5}), "DFS order on the default graph");
        StepRecorder rec3(true);
        Json k = runTraced(*dij, dij->defaultInput(), rec3);
        s.check(toInts(k["path"]) == std::vector<int>({0, 2, 4, 3, 5}), "Dijkstra shortest path on the default graph");
        s.check(k["dist"].at(5).asInt() == 20, "Dijkstra distance to node 5 is 20");
    }

    for (int trial = 0; trial < 200; ++trial) {
        int n = 2 + static_cast<int>(rng() % 9);
        bool directed = trial % 3 == 0;
        int edgeCount = static_cast<int>(rng() % 20);
        Json edges = Json::array();
        std::vector<GraphEdge> list;
        for (int e = 0; e < edgeCount; ++e) {
            int u = static_cast<int>(rng() % static_cast<unsigned>(n)), v = static_cast<int>(rng() % static_cast<unsigned>(n));
            if (u == v) continue;
            int w = static_cast<int>(rng() % 20);
            edges.push(Json::array({u, v, w}));
            list.push_back({u, v, w});
        }
        int start = static_cast<int>(rng() % static_cast<unsigned>(n));
        Json input = Json::object({{"nodes", n}, {"directed", directed}, {"edges", edges}, {"start", start}});
        s.check(dij->validate(input).ok, "graph input validates");

        StepRecorder r1(true);
        Json dj = runTraced(*dij, input, r1);
        std::vector<long long> ref = referenceDistances(n, list, directed, start);
        bool same = true;
        for (int v = 0; v < n; ++v) {
            long long got = dj["dist"].at(static_cast<std::size_t>(v)).isNull() ? -1 : dj["dist"].at(static_cast<std::size_t>(v)).asInt();
            if (got != ref[static_cast<std::size_t>(v)]) same = false;
        }
        s.check(same, "Dijkstra distances match Bellman-Ford");
        s.check(stepsWellFormed(r1.steps()), "Dijkstra steps well formed");

        StepRecorder r2(true), r3(true);
        Json b = runTraced(*bfs, input, r2);
        Json d = runTraced(*dfs, input, r3);
        std::set<int> reachable;
        for (int v = 0; v < n; ++v)
            if (ref[static_cast<std::size_t>(v)] >= 0) reachable.insert(v);
        std::vector<int> bo = toInts(b["order"]), dd = toInts(d["order"]);
        s.check(std::set<int>(bo.begin(), bo.end()) == reachable && bo.size() == reachable.size(), "BFS visits exactly the reachable nodes");
        s.check(std::set<int>(dd.begin(), dd.end()) == reachable && dd.size() == reachable.size(), "DFS visits exactly the reachable nodes");
        s.check(stepsWellFormed(r2.steps()) && stepsWellFormed(r3.steps()), "BFS/DFS steps well formed");
    }
    s.check(!dij->validate(Json::object({{"nodes", 3}, {"edges", Json::array({Json::array({0, 1, -4})})}, {"start", 0}})).ok,
            "Dijkstra rejects negative weights");
    s.check(!bfs->validate(Json::object({{"nodes", 3}, {"edges", Json::array({Json::array({0, 7})})}, {"start", 0}})).ok,
            "graph rejects out-of-range node");
    s.section("Graph algorithms vs reference implementations", f, c);
}

void testStructures(const AlgorithmManager& m, Suite& s) {
    int f = s.failures, c = s.checks;
    auto run = [&](const char* id, const Json& input) {
        const Algorithm* a = m.find(id);
        StepRecorder rec(true);
        Json r = a->run(input, rec);
        s.check(stepsWellFormed(rec.steps()), std::string(id) + " steps well formed");
        return r;
    };
    for (const char* id : {"stack", "queue", "singly_linked_list", "doubly_linked_list", "circular_linked_list"}) {
        s.check(m.find(id) && m.find(id)->validate(m.find(id)->defaultInput()).ok, std::string(id) + " default input valid");
    }
    Json r = run("stack", m.find("stack")->defaultInput());
    s.check(toInts(r["items"]).empty(), "stack default ends empty");
    s.check(!r["log"].at(9).at(0).asBool(true) || !r["log"].at(9)["ok"].asBool(true), "stack default ends with underflow");
    s.check(r["log"].at(4)["value"].asInt() == 30, "stack pop returns LIFO order");
    r = run("queue", m.find("queue")->defaultInput());
    s.check(toInts(r["items"]) == std::vector<int>({13, 21, 34, 55, 89}), "queue default final contents (circular wrap)");
    s.check(!r["log"].at(10)["ok"].asBool(true), "queue overflow is reported");
    r = run("singly_linked_list", m.find("singly_linked_list")->defaultInput());
    s.check(toInts(r["items"]) == std::vector<int>({5, 15, 20}), "singly linked list default result");
    r = run("doubly_linked_list", m.find("doubly_linked_list")->defaultInput());
    s.check(toInts(r["items"]) == std::vector<int>({5, 15, 20}), "doubly linked list default result");
    s.check(toInts(r["log"].at(6)["value"]) == std::vector<int>({20, 15, 5}), "doubly linked list backward traversal");
    r = run("circular_linked_list", m.find("circular_linked_list")->defaultInput());
    s.check(toInts(r["items"]) == std::vector<int>({10, 20}), "circular linked list default result");

    // Randomised model checking of the three list implementations.
    std::mt19937 rng(5);
    for (const char* id : {"singly_linked_list", "doubly_linked_list", "circular_linked_list"}) {
        for (int trial = 0; trial < 150; ++trial) {
            std::vector<int> model;
            Json ops = Json::array();
            for (int k = 0; k < 25; ++k) {
                int v = static_cast<int>(rng() % 6);
                switch (rng() % 4) {
                    case 0:
                        if (model.size() < 10) model.insert(model.begin(), v);
                        ops.push("insert_head " + std::to_string(v));
                        break;
                    case 1:
                        if (model.size() < 10) model.push_back(v);
                        ops.push("insert_tail " + std::to_string(v));
                        break;
                    case 2: {
                        auto it = std::find(model.begin(), model.end(), v);
                        if (it != model.end()) model.erase(it);
                        ops.push("delete " + std::to_string(v));
                        break;
                    }
                    default: ops.push("search " + std::to_string(v));
                }
            }
            Json input = Json::object({{"ops", ops}});
            StepRecorder rec(true);
            Json res = m.find(id)->run(input, rec);
            s.check(toInts(res["items"]) == model, std::string(id) + " matches std::vector model");
        }
    }
    s.check(!m.find("stack")->validate(Json::object({{"ops", Json::array({"explode 1"})}})).ok, "stack rejects unknown operation");
    s.check(!m.find("stack")->validate(Json::object({{"ops", Json::array({"push"})}})).ok, "stack rejects missing argument");
    s.section("Data structures vs expected behaviour", f, c);
}

void testRecursionAndMath(const AlgorithmManager& m, Suite& s) {
    int f = s.failures, c = s.checks;
    unsigned long long fact = 1;
    for (int n = 0; n <= 20; ++n) {
        if (n > 1) fact *= static_cast<unsigned long long>(n);
        StepRecorder rec(true);
        Json r = m.find("factorial")->run(Json::object({{"n", n}}), rec);
        s.check(r["value"].asString() == std::to_string(fact), "factorial(" + std::to_string(n) + ")");
        s.check(stepsWellFormed(rec.steps()), "factorial steps well formed");
        s.check(rec.stats().calls == (n < 1 ? 1 : n), "factorial call count");
    }
    long long fibs[40] = {0, 1};
    for (int i = 2; i < 40; ++i) fibs[i] = fibs[i - 1] + fibs[i - 2];
    for (int n = 0; n <= 12; ++n) {
        StepRecorder rec(true);
        Json r = m.find("fibonacci")->run(Json::object({{"n", n}}), rec);
        s.check(r["value"].asString() == std::to_string(fibs[n]), "fibonacci(" + std::to_string(n) + ")");
        s.check(r["calls"].asInt() == 2 * fibs[n + 1] - 1, "fibonacci call count 2*F(n+1)-1");
        s.check(stepsWellFormed(rec.steps()), "fibonacci steps well formed");
    }
    std::mt19937 rng(3);
    for (int trial = 0; trial < 300; ++trial) {
        long long a = rng() % 1000000, b = rng() % 1000000;
        if (trial % 7 == 0) a = 0;
        if (a == 0 && b == 0) b = 1;
        StepRecorder rec(true);
        Json r = m.find("gcd")->run(Json::object({{"a", a}, {"b", b}}), rec);
        s.check(r["gcd"].asInt() == std::gcd(a, b), "gcd matches std::gcd");
        s.check(stepsWellFormed(rec.steps()), "gcd steps well formed");
    }
    s.check(!m.find("gcd")->validate(Json::object({{"a", 0}, {"b", 0}})).ok, "gcd rejects (0, 0)");
    for (int n = 2; n <= 200; ++n) {
        StepRecorder rec(true);
        Json r = m.find("sieve")->run(Json::object({{"n", n}}), rec);
        std::vector<int> expected;
        for (int k = 2; k <= n; ++k) {
            bool prime = true;
            for (int d = 2; d * d <= k; ++d)
                if (k % d == 0) prime = false;
            if (prime) expected.push_back(k);
        }
        s.check(toInts(r["primes"]) == expected, "sieve primes up to " + std::to_string(n));
        s.check(stepsWellFormed(rec.steps()), "sieve steps well formed");
    }
    s.section("Recursion and mathematical algorithms", f, c);
}

void testExpressions(Suite& s) {
    int f = s.failures, c = s.checks;
    ExpressionEvaluator ev;
    const std::pair<const char*, const char*> good[] = {
        {"1+2*3", "7"}, {"(1+2)*3", "9"}, {"-2^2", "-4"}, {"2^3^2", "512"}, {"2^-2", "0.25"}, {"10/4", "2.5"},
        {"10%4", "2"}, {"0.1+0.2", "0.3"}, {"-(3+4)*2", "-14"}, {"2**3", "8"}, {"  7 - -3 ", "10"}, {"3.5*2", "7"},
        {"((2))", "2"}, {"1e3+1", "1001"}, {"100/3", "33.3333333333"}, {"2*(3+(4-1))^2", "72"}, {"+5", "5"}, {"5.5%2", "1.5"}};
    for (const auto& g : good) {
        MathResult r = ev.evaluate(g.first);
        s.check(r.ok && r.formatted == g.second, std::string("evaluate ") + g.first + " = " + g.second + (r.ok ? " got " + r.formatted : " error " + r.error));
    }
    for (const char* bad : {"1/0", "5%0", "(1+2", "1+2)", "abc", "2+", "*3", "", "   ", "2 3", "()", "1..2", "0^-1", "(-8)^0.5", "2 $ 3", "9999999999^999999"}) {
        s.check(!ev.evaluate(bad).ok, std::string("reject '") + bad + "'");
    }
    s.check(!ev.evaluate(std::string(300, '1')).ok, "reject over-long expression");
    s.section("Shunting Yard expression evaluator", f, c);
}

void testComplexity(const AlgorithmManager& m, Suite& s) {
    int f = s.failures, c = s.checks;
    ComplexityAnalyzer analyzer(m);
    struct Expect {
        const char* id;
        const char* mode;
        std::vector<std::string> accepted;
    };
    const Expect expectations[] = {
        {"bubble_sort", "typical", {"O(n^2)"}},   {"selection_sort", "worst", {"O(n^2)"}},
        {"insertion_sort", "worst", {"O(n^2)"}},  {"merge_sort", "typical", {"O(n log n)"}},
        {"heap_sort", "typical", {"O(n log n)"}}, {"quick_sort", "typical", {"O(n log n)"}},
        {"quick_sort", "worst", {"O(n^2)"}},      {"linear_search", "worst", {"O(n)"}},
        {"binary_search", "worst", {"O(log n)"}}, {"jump_search", "worst", {"O(sqrt n)"}},
        {"factorial", "typical", {"O(n)"}},       {"sieve", "typical", {"O(n)", "O(n log n)"}}};
    for (const Expect& e : expectations) {
        Json report = analyzer.measure(e.id);
        std::string best;
        for (const Json& mode : report["modes"].items())
            if (mode["mode"].asString() == e.mode) best = mode["fit"]["best"].asString();
        bool ok = std::find(e.accepted.begin(), e.accepted.end(), best) != e.accepted.end();
        s.check(ok, std::string("growth fit ") + e.id + "/" + e.mode + " expected " + e.accepted[0] + " got " + best);
    }
    Json fib = analyzer.measure("fibonacci");
    s.check(fib["modes"].at(0)["fit"]["best"].asString().rfind("O(b^n)", 0) == 0, "growth fit fibonacci is exponential");
    s.check(!analyzer.measure("stack")["supported"].asBool(true), "stack reports unsupported scaling");
    s.section("ComplexityAnalyzer empirical growth fitting", f, c);
}

void testEngine(const AlgorithmManager& m, Suite& s) {
    int f = s.failures, c = s.checks;
    ExecutionEngine engine(m);
    for (const Algorithm* a : m.all()) {
        ExecutionReport report = engine.execute(a->info().id, a->defaultInput());
        s.check(report.ok, a->info().id + " executes via ExecutionEngine");
        s.check(report.stepCount > 0 && !report.truncated, a->info().id + " produces steps within the cap");
        Json json = Json::parse(report.toJson(*a, a->defaultInput()).dump());
        s.check(json["ok"].asBool() && json["steps"].isArray(), a->info().id + " report serialises to valid JSON");
        s.check(report.durationMicros >= 0.0 && report.timingRuns >= 5, a->info().id + " measured duration");
    }
    s.check(!engine.execute("nope", Json::object()).ok, "engine rejects unknown algorithm");
    Json big = Json::array();
    for (int i = 0; i < 41; ++i) big.push(i);
    s.check(!engine.execute("bubble_sort", Json::object({{"array", big}})).ok, "engine rejects 41 elements");
    s.check(!engine.execute("bubble_sort", Json::object({{"array", Json::array({1, 2.5})}})).ok, "engine rejects non-integer element");
    s.check(!engine.execute("bubble_sort", Json::object({{"array", "x"}})).ok, "engine rejects non-array input");
    s.section("ExecutionEngine integration", f, c);
}

}  // namespace

int runSelfTest(const AlgorithmManager& manager, std::ostream& out) {
    Suite suite{out};
    out << "BYTEFORGE C++ self-test\n";
    out << "Algorithms registered: " << manager.count() << "\n";
    suite.check(manager.count() == 21, "21 algorithms are registered");
    testSorting(manager, suite);
    testSearching(manager, suite);
    testGraph(manager, suite);
    testStructures(manager, suite);
    testRecursionAndMath(manager, suite);
    testExpressions(suite);
    testComplexity(manager, suite);
    testEngine(manager, suite);
    out << "Checks run: " << suite.checks << ", failed: " << suite.failures << "\n";
    return suite.failures;
}

}  // namespace bf
