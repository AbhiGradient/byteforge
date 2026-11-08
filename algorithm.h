#pragma once
#include <chrono>
#include <cstddef>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "json.h"

namespace bf {

// ---------------------------------------------------------------------------
// Value types shared by every algorithm
// ---------------------------------------------------------------------------

struct Complexity {
    std::string best;
    std::string average;
    std::string worst;
    std::string space;
};

struct AlgorithmInfo {
    std::string id;
    std::string name;
    std::string category;       // sorting, searching, graph, structure, recursion, math
    std::string visualization;  // bars, cells, graph, structure, calltree, gcd, sieve
    Complexity complexity;
};

struct ValidationResult {
    bool ok = true;
    std::string error;
    static ValidationResult success() { return ValidationResult{}; }
    static ValidationResult failure(const std::string& message) {
        ValidationResult r;
        r.ok = false;
        r.error = message;
        return r;
    }
};

struct Stats {
    long long comparisons = 0;
    long long swaps = 0;
    long long writes = 0;
    long long calls = 0;
    long long operations = 0;  // every counted primitive operation
    Json toJson() const;
};

// One recorded unit of execution. `line` is the real source line (__LINE__)
// of the C++ statement that produced it, so the code explorer can highlight it.
struct ExecutionStep {
    int index = 0;
    std::string type;
    int line = 0;
    std::string message;
    Json data = Json::object();
    Json toJson() const;
};

// Collects statistics (always) and execution steps (only when enabled).
class StepRecorder {
public:
    explicit StepRecorder(bool enabled, std::size_t maxSteps = 20000)
        : enabled_(enabled), maxSteps_(maxSteps) {}

    bool enabled() const { return enabled_ && !truncated_; }
    bool truncated() const { return truncated_; }
    Stats& stats() { return stats_; }
    const Stats& stats() const { return stats_; }
    const std::vector<ExecutionStep>& steps() const { return steps_; }

    void emit(const std::string& type, int line, const std::string& message,
              Json data = Json::object());

private:
    bool enabled_;
    bool truncated_ = false;
    std::size_t maxSteps_;
    Stats stats_;
    std::vector<ExecutionStep> steps_;
};

// ---------------------------------------------------------------------------
// InputValidator: every algorithm validates its input through this class.
// ---------------------------------------------------------------------------

struct GraphEdge {
    int from;
    int to;
    int weight;
};

struct Graph {
    int nodes = 0;
    bool directed = false;
    std::vector<GraphEdge> edges;
    std::vector<std::vector<std::pair<int, int>>> adjacency;  // (neighbour, weight)
    void buildAdjacency();
};

class InputValidator {
public:
    static ValidationResult integerArray(const Json& value, const std::string& field,
                                         std::size_t minSize, std::size_t maxSize,
                                         int minValue, int maxValue, std::vector<int>& out);
    static ValidationResult integerInRange(const Json& value, const std::string& field,
                                           long long minValue, long long maxValue, long long& out);
    static ValidationResult sortedAscending(const std::vector<int>& values);
    static ValidationResult operations(const Json& value, std::size_t maxOps,
                                       std::vector<std::string>& out);
    static ValidationResult graph(const Json& input, int maxNodes, int maxEdges,
                                  bool requireNonNegativeWeights, Graph& out);
};

// ---------------------------------------------------------------------------
// Algorithm: abstract base class (abstraction + runtime polymorphism)
// ---------------------------------------------------------------------------

class Algorithm {
public:
    explicit Algorithm(AlgorithmInfo info) : info_(std::move(info)) {}
    virtual ~Algorithm() = default;
    Algorithm(const Algorithm&) = delete;
    Algorithm& operator=(const Algorithm&) = delete;

    const AlgorithmInfo& info() const { return info_; }

    virtual Json defaultInput() const = 0;
    virtual ValidationResult validate(const Json& input) const = 0;
    // Runs the algorithm on already validated input, reporting through `rec`.
    virtual Json run(const Json& input, StepRecorder& rec) const = 0;

    // Scalable inputs for ComplexityAnalyzer. `worst` selects an adversarial input.
    virtual bool supportsScaling() const { return false; }
    virtual std::vector<std::size_t> scalingSizes() const { return {}; }
    virtual Json scaledInput(std::size_t, bool) const { return Json::object(); }

private:
    AlgorithmInfo info_;
};

// ---------------------------------------------------------------------------
// AlgorithmManager: owns every algorithm and resolves them by id.
// ---------------------------------------------------------------------------

class AlgorithmManager {
public:
    void add(std::unique_ptr<Algorithm> algorithm);
    const Algorithm* find(const std::string& id) const;
    std::vector<const Algorithm*> all() const;
    std::size_t count() const { return order_.size(); }
    Json describeAll() const;
    static Json describe(const Algorithm& algorithm);

private:
    std::map<std::string, std::unique_ptr<Algorithm>> algorithms_;
    std::vector<std::string> order_;
};

// ---------------------------------------------------------------------------
// ExecutionEngine: validate -> time (no tracing) -> trace -> report.
// ---------------------------------------------------------------------------

struct ExecutionReport {
    bool ok = false;
    std::string error;
    Json result;
    Stats stats;
    long long stepCount = 0;
    bool truncated = false;
    double durationMicros = 0.0;
    int timingRuns = 0;
    std::vector<ExecutionStep> steps;
    Json toJson(const Algorithm& algorithm, const Json& input) const;
};

class ExecutionEngine {
public:
    explicit ExecutionEngine(const AlgorithmManager& manager) : manager_(manager) {}
    ExecutionReport execute(const std::string& id, const Json& input) const;
    ValidationResult validate(const std::string& id, const Json& input) const;

private:
    const AlgorithmManager& manager_;
};

// ---------------------------------------------------------------------------
// ComplexityAnalyzer: theoretical table + empirical growth-rate fitting.
// ---------------------------------------------------------------------------

class ComplexityAnalyzer {
public:
    explicit ComplexityAnalyzer(const AlgorithmManager& manager) : manager_(manager) {}
    static Json theoretical(const Algorithm& algorithm);
    Json measure(const std::string& id) const;

private:
    const AlgorithmManager& manager_;
};

// Module registration hooks (implemented in each module's .cpp file).
void registerSortingAlgorithms(AlgorithmManager& manager);
void registerSearchingAlgorithms(AlgorithmManager& manager);
void registerGraphAlgorithms(AlgorithmManager& manager);
void registerStructureAlgorithms(AlgorithmManager& manager);
void registerRecursionAlgorithms(AlgorithmManager& manager);
void registerMathAlgorithms(AlgorithmManager& manager);
void registerAllAlgorithms(AlgorithmManager& manager);

}  // namespace bf
