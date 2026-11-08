#include "algorithm.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace bf {

// ----------------------------- Stats / steps --------------------------------

Json Stats::toJson() const {
    return Json::object({{"comparisons", comparisons},
                         {"swaps", swaps},
                         {"writes", writes},
                         {"calls", calls},
                         {"operations", operations}});
}

Json ExecutionStep::toJson() const {
    return Json::object({{"i", index}, {"type", type}, {"line", line}, {"msg", message}, {"data", data}});
}

void StepRecorder::emit(const std::string& type, int line, const std::string& message, Json data) {
    if (!enabled_ || truncated_) return;
    if (steps_.size() >= maxSteps_) {
        truncated_ = true;
        return;
    }
    ExecutionStep step;
    step.index = static_cast<int>(steps_.size());
    step.type = type;
    step.line = line;
    step.message = message;
    step.data = std::move(data);
    steps_.push_back(std::move(step));
}

// ----------------------------- InputValidator -------------------------------

void Graph::buildAdjacency() {
    adjacency.assign(static_cast<std::size_t>(nodes), {});
    for (const GraphEdge& e : edges) {
        adjacency[static_cast<std::size_t>(e.from)].push_back({e.to, e.weight});
        if (!directed) adjacency[static_cast<std::size_t>(e.to)].push_back({e.from, e.weight});
    }
    for (auto& list : adjacency) std::sort(list.begin(), list.end());
}

ValidationResult InputValidator::integerArray(const Json& value, const std::string& field,
                                              std::size_t minSize, std::size_t maxSize, int minValue,
                                              int maxValue, std::vector<int>& out) {
    out.clear();
    if (!value.isArray())
        return ValidationResult::failure("'" + field + "' must be an array of integers.");
    if (value.size() < minSize)
        return ValidationResult::failure("'" + field + "' needs at least " + std::to_string(minSize) +
                                         " element(s).");
    if (value.size() > maxSize)
        return ValidationResult::failure("'" + field + "' can hold at most " + std::to_string(maxSize) +
                                         " elements for visualization.");
    for (std::size_t i = 0; i < value.size(); ++i) {
        const Json& v = value.at(i);
        if (!v.isInteger())
            return ValidationResult::failure("Element " + std::to_string(i + 1) + " of '" + field +
                                             "' is not an integer.");
        long long n = v.asInt();
        if (n < minValue || n > maxValue)
            return ValidationResult::failure("Element " + std::to_string(i + 1) + " of '" + field +
                                             "' must be between " + std::to_string(minValue) + " and " +
                                             std::to_string(maxValue) + ".");
        out.push_back(static_cast<int>(n));
    }
    return ValidationResult::success();
}

ValidationResult InputValidator::integerInRange(const Json& value, const std::string& field,
                                                long long minValue, long long maxValue, long long& out) {
    if (!value.isInteger()) return ValidationResult::failure("'" + field + "' must be an integer.");
    out = value.asInt();
    if (out < minValue || out > maxValue)
        return ValidationResult::failure("'" + field + "' must be between " + std::to_string(minValue) +
                                         " and " + std::to_string(maxValue) + ".");
    return ValidationResult::success();
}

ValidationResult InputValidator::sortedAscending(const std::vector<int>& values) {
    for (std::size_t i = 1; i < values.size(); ++i)
        if (values[i - 1] > values[i])
            return ValidationResult::failure(
                "This algorithm requires a sorted (ascending) array. Use the 'Sort input' button first.");
    return ValidationResult::success();
}

ValidationResult InputValidator::operations(const Json& value, std::size_t maxOps,
                                            std::vector<std::string>& out) {
    out.clear();
    if (!value.isArray()) return ValidationResult::failure("'ops' must be an array of operation strings.");
    if (value.size() == 0) return ValidationResult::failure("Provide at least one operation.");
    if (value.size() > maxOps)
        return ValidationResult::failure("At most " + std::to_string(maxOps) + " operations are allowed.");
    for (std::size_t i = 0; i < value.size(); ++i) {
        const Json& v = value.at(i);
        if (!v.isString() || v.asString().empty() || v.asString().size() > 40)
            return ValidationResult::failure("Operation " + std::to_string(i + 1) +
                                             " must be a short, non-empty string.");
        out.push_back(v.asString());
    }
    return ValidationResult::success();
}

ValidationResult InputValidator::graph(const Json& input, int maxNodes, int maxEdges,
                                       bool requireNonNegativeWeights, Graph& out) {
    out = Graph{};
    long long nodes = 0;
    ValidationResult r = integerInRange(input["nodes"], "nodes", 2, maxNodes, nodes);
    if (!r.ok) return r;
    out.nodes = static_cast<int>(nodes);
    out.directed = input["directed"].asBool(false);

    const Json& edges = input["edges"];
    if (!edges.isArray()) return ValidationResult::failure("'edges' must be an array of [from, to, weight] triples.");
    if (edges.size() > static_cast<std::size_t>(maxEdges))
        return ValidationResult::failure("At most " + std::to_string(maxEdges) + " edges are allowed.");

    for (std::size_t i = 0; i < edges.size(); ++i) {
        const Json& e = edges.at(i);
        std::string label = "Edge " + std::to_string(i + 1);
        if (!e.isArray() || (e.size() != 2 && e.size() != 3))
            return ValidationResult::failure(label + " must be [from, to] or [from, to, weight].");
        long long u = 0, v = 0, w = 1;
        r = integerInRange(e.at(0), label + " source", 0, nodes - 1, u);
        if (!r.ok) return r;
        r = integerInRange(e.at(1), label + " target", 0, nodes - 1, v);
        if (!r.ok) return r;
        if (u == v) return ValidationResult::failure(label + " is a self-loop, which is not supported.");
        if (e.size() == 3) {
            if (!e.at(2).isInteger()) return ValidationResult::failure(label + " weight must be an integer.");
            w = e.at(2).asInt();
            if (requireNonNegativeWeights && w < 0)
                return ValidationResult::failure(label + " has a negative weight; Dijkstra requires non-negative weights.");
            if (w < 0 || w > 99) return ValidationResult::failure(label + " weight must be between 0 and 99.");
        }
        out.edges.push_back({static_cast<int>(u), static_cast<int>(v), static_cast<int>(w)});
    }

    long long start = 0;
    r = integerInRange(input.has("start") ? input["start"] : Json(0), "start", 0, nodes - 1, start);
    if (!r.ok) return r;
    if (input.has("target") && !input["target"].isNull()) {
        long long target = 0;
        r = integerInRange(input["target"], "target", 0, nodes - 1, target);
        if (!r.ok) return r;
    }
    out.buildAdjacency();
    return ValidationResult::success();
}

// ----------------------------- AlgorithmManager -----------------------------

void AlgorithmManager::add(std::unique_ptr<Algorithm> algorithm) {
    const std::string id = algorithm->info().id;
    order_.push_back(id);
    algorithms_[id] = std::move(algorithm);
}

const Algorithm* AlgorithmManager::find(const std::string& id) const {
    auto it = algorithms_.find(id);
    return it == algorithms_.end() ? nullptr : it->second.get();
}

std::vector<const Algorithm*> AlgorithmManager::all() const {
    std::vector<const Algorithm*> out;
    for (const std::string& id : order_) out.push_back(algorithms_.at(id).get());
    return out;
}

Json AlgorithmManager::describe(const Algorithm& a) {
    const AlgorithmInfo& i = a.info();
    return Json::object({{"id", i.id},
                         {"name", i.name},
                         {"category", i.category},
                         {"visualization", i.visualization},
                         {"complexity", ComplexityAnalyzer::theoretical(a)},
                         {"defaultInput", a.defaultInput()},
                         {"supportsScaling", a.supportsScaling()}});
}

Json AlgorithmManager::describeAll() const {
    Json list = Json::array();
    for (const Algorithm* a : all()) list.push(describe(*a));
    return list;
}

void registerAllAlgorithms(AlgorithmManager& manager) {
    registerSortingAlgorithms(manager);
    registerSearchingAlgorithms(manager);
    registerGraphAlgorithms(manager);
    registerStructureAlgorithms(manager);
    registerRecursionAlgorithms(manager);
    registerMathAlgorithms(manager);
}

// ----------------------------- ExecutionEngine ------------------------------

namespace {

using Clock = std::chrono::steady_clock;

double microsSince(Clock::time_point start) {
    return std::chrono::duration<double, std::micro>(Clock::now() - start).count();
}

long long inputSizeOf(const Json& input) {
    if (input["array"].isArray()) return static_cast<long long>(input["array"].size());
    if (input["nodes"].isNumber()) return input["nodes"].asInt();
    if (input["ops"].isArray()) return static_cast<long long>(input["ops"].size());
    if (input["n"].isNumber()) return input["n"].asInt();
    if (input["a"].isNumber() && input["b"].isNumber()) return std::max(input["a"].asInt(), input["b"].asInt());
    return 0;
}

}  // namespace

ValidationResult ExecutionEngine::validate(const std::string& id, const Json& input) const {
    const Algorithm* algorithm = manager_.find(id);
    if (!algorithm) return ValidationResult::failure("Unknown algorithm '" + id + "'.");
    return algorithm->validate(input);
}

ExecutionReport ExecutionEngine::execute(const std::string& id, const Json& input) const {
    ExecutionReport report;
    const Algorithm* algorithm = manager_.find(id);
    if (!algorithm) {
        report.error = "Unknown algorithm '" + id + "'.";
        return report;
    }
    ValidationResult check = algorithm->validate(input);
    if (!check.ok) {
        report.error = check.error;
        return report;
    }

    // Phase 1: measure wall-clock time with step recording switched off.
    std::vector<double> samples;
    double budget = 0;
    while (samples.size() < 200 && (samples.size() < 5 || budget < 2000.0)) {
        StepRecorder quiet(false);
        auto start = Clock::now();
        algorithm->run(input, quiet);
        double elapsed = microsSince(start);
        samples.push_back(elapsed);
        budget += elapsed;
    }
    std::sort(samples.begin(), samples.end());
    report.durationMicros = samples[samples.size() / 2];
    report.timingRuns = static_cast<int>(samples.size());

    // Phase 2: trace the same input, recording every step.
    StepRecorder recorder(true);
    report.result = algorithm->run(input, recorder);
    report.stats = recorder.stats();
    report.steps = recorder.steps();
    report.stepCount = static_cast<long long>(report.steps.size());
    report.truncated = recorder.truncated();
    report.ok = true;
    return report;
}

Json ExecutionReport::toJson(const Algorithm& algorithm, const Json& input) const {
    Json out = Json::object();
    out["ok"] = ok;
    if (!ok) {
        out["error"] = error;
        return out;
    }
    const AlgorithmInfo& info = algorithm.info();
    out["algorithm"] = Json::object({{"id", info.id},
                                     {"name", info.name},
                                     {"category", info.category},
                                     {"visualization", info.visualization}});
    out["input"] = input;
    out["result"] = result;
    out["stats"] = stats.toJson();
    out["meta"] = Json::object({{"steps", stepCount},
                                {"truncated", truncated},
                                {"inputSize", inputSizeOf(input)},
                                {"durationMicros", durationMicros},
                                {"timingRuns", timingRuns}});
    out["complexity"] = ComplexityAnalyzer::theoretical(algorithm);
    Json list = Json::array();
    for (const ExecutionStep& s : steps) list.push(s.toJson());
    out["steps"] = std::move(list);
    return out;
}

// ----------------------------- ComplexityAnalyzer ---------------------------

Json ComplexityAnalyzer::theoretical(const Algorithm& algorithm) {
    const Complexity& c = algorithm.info().complexity;
    return Json::object({{"best", c.best}, {"average", c.average}, {"worst", c.worst}, {"space", c.space}});
}

namespace {

struct Model {
    const char* name;
    double (*fn)(double);
};

double mConst(double) { return 1.0; }
double mLog(double n) { return std::log2(std::max(n, 2.0)); }
double mSqrt(double n) { return std::sqrt(n); }
double mLinear(double n) { return n; }
double mNLogN(double n) { return n * std::log2(std::max(n, 2.0)); }
double mQuad(double n) { return n * n; }

const Model kModels[] = {{"O(1)", mConst},      {"O(log n)", mLog},    {"O(sqrt n)", mSqrt},
                         {"O(n)", mLinear},     {"O(n log n)", mNLogN}, {"O(n^2)", mQuad}};

double variance(const std::vector<double>& v) {
    if (v.empty()) return 0.0;
    double mean = 0;
    for (double x : v) mean += x;
    mean /= static_cast<double>(v.size());
    double s = 0;
    for (double x : v) s += (x - mean) * (x - mean);
    return s / static_cast<double>(v.size());
}

Json fitModels(const std::vector<std::size_t>& sizes, const std::vector<long long>& ops) {
    struct Candidate {
        std::string name;
        double error;
        double constant;
    };
    std::vector<Candidate> candidates;
    for (const Model& m : kModels) {
        std::vector<double> residuals;
        for (std::size_t i = 0; i < sizes.size(); ++i)
            residuals.push_back(std::log(std::max<double>(static_cast<double>(ops[i]), 1.0)) -
                                std::log(m.fn(static_cast<double>(sizes[i]))));
        double mean = 0;
        for (double r : residuals) mean += r;
        mean /= static_cast<double>(residuals.size());
        candidates.push_back({m.name, variance(residuals), std::exp(mean)});
    }
    // Exponential family: fit log(ops) = log(c) + n*log(b) by least squares.
    {
        double sx = 0, sy = 0, sxx = 0, sxy = 0, k = static_cast<double>(sizes.size());
        for (std::size_t i = 0; i < sizes.size(); ++i) {
            double x = static_cast<double>(sizes[i]);
            double y = std::log(std::max<double>(static_cast<double>(ops[i]), 1.0));
            sx += x; sy += y; sxx += x * x; sxy += x * y;
        }
        double denom = k * sxx - sx * sx;
        double slope = denom == 0 ? 0 : (k * sxy - sx * sy) / denom;
        double intercept = (sy - slope * sx) / k;
        std::vector<double> residuals;
        for (std::size_t i = 0; i < sizes.size(); ++i)
            residuals.push_back(std::log(std::max<double>(static_cast<double>(ops[i]), 1.0)) -
                                (intercept + slope * static_cast<double>(sizes[i])));
        char label[48];
        std::snprintf(label, sizeof label, "O(b^n), b~%.2f", std::exp(slope));
        // The exponential model has two free parameters, so penalise it slightly.
        candidates.push_back({label, variance(residuals) * 4.0 + 1e-9, std::exp(intercept)});
    }
    std::sort(candidates.begin(), candidates.end(),
              [](const Candidate& a, const Candidate& b) { return a.error < b.error; });
    Json list = Json::array();
    for (const Candidate& c : candidates)
        list.push(Json::object({{"model", c.name}, {"error", c.error}, {"constant", c.constant}}));
    return Json::object({{"best", candidates.front().name}, {"candidates", list}});
}

}  // namespace

Json ComplexityAnalyzer::measure(const std::string& id) const {
    const Algorithm* algorithm = manager_.find(id);
    if (!algorithm) return Json::object({{"ok", false}, {"error", "Unknown algorithm '" + id + "'."}});
    if (!algorithm->supportsScaling())
        return Json::object({{"ok", true},
                             {"supported", false},
                             {"note", "This algorithm operates on a fixed small scenario, so empirical growth fitting is not available."}});

    Json modes = Json::array();
    for (bool worst : {false, true}) {
        std::vector<std::size_t> sizes = algorithm->scalingSizes();
        std::vector<long long> opsList;
        Json samples = Json::array();
        for (std::size_t n : sizes) {
            Json input = algorithm->scaledInput(n, worst);
            double best = 1e18;
            Stats stats;
            for (int rep = 0; rep < 3; ++rep) {
                StepRecorder quiet(false);
                auto start = Clock::now();
                algorithm->run(input, quiet);
                best = std::min(best, microsSince(start));
                stats = quiet.stats();
            }
            opsList.push_back(stats.operations);
            samples.push(Json::object({{"n", n},
                                       {"operations", stats.operations},
                                       {"comparisons", stats.comparisons},
                                       {"swaps", stats.swaps},
                                       {"micros", best}}));
        }
        Json fit = fitModels(sizes, opsList);
        modes.push(Json::object({{"mode", worst ? "worst" : "typical"},
                                 {"description", worst ? "Adversarial input chosen to trigger the worst case"
                                                       : "Pseudo-random input (fixed seed)"},
                                 {"samples", samples},
                                 {"fit", fit}}));
    }
    return Json::object({{"ok", true},
                         {"supported", true},
                         {"metric", "operations counted by the C++ engine"},
                         {"theoretical", theoretical(*algorithm)},
                         {"modes", modes}});
}

}  // namespace bf
