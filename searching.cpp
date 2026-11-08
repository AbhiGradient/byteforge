#include "searching.h"

#include <algorithm>
#include <cmath>

namespace bf {

namespace {

class SearchTrace {
public:
    SearchTrace(StepRecorder& rec, const std::vector<int>& a, int target) : rec_(rec), a_(a), target_(target) {}

    void inspect(int line, int idx) {
        ++rec_.stats().comparisons;
        ++rec_.stats().operations;
        if (!rec_.enabled()) return;
        const char* rel = a_[idx] == target_ ? " = " : (a_[idx] < target_ ? " < " : " > ");
        rec_.emit("compare", line,
                  "Check a[" + std::to_string(idx) + "]=" + std::to_string(a_[idx]) + rel + "target " +
                      std::to_string(target_),
                  Json::object({{"cmp", Json::array({idx})}}));
    }
    void bounds(int line, int low, int high, int mid) {
        if (rec_.enabled())
            rec_.emit("window", line,
                      "Search window [" + std::to_string(low) + ".." + std::to_string(high) + "], mid = " +
                          std::to_string(mid),
                      Json::object({{"low", low}, {"high", high}, {"mid", mid}}));
    }
    void block(int line, int from, int to) {
        if (rec_.enabled())
            rec_.emit("jump", line,
                      "Jump to block [" + std::to_string(from) + ".." + std::to_string(to) + "]",
                      Json::object({{"block", Json::array({from, to})}}));
    }
    void found(int line, int idx) {
        if (rec_.enabled())
            rec_.emit("found", line, "Found " + std::to_string(target_) + " at index " + std::to_string(idx),
                      Json::object({{"found", idx}}));
    }
    void missing(int line) {
        if (rec_.enabled())
            rec_.emit("missing", line, std::to_string(target_) + " is not in the array",
                      Json::object({{"found", -1}}));
    }

private:
    StepRecorder& rec_;
    const std::vector<int>& a_;
    int target_;
};

#define INSPECT(i) tr.inspect(__LINE__, (i))
#define BOUNDS(lo, hi, mid) tr.bounds(__LINE__, (lo), (hi), (mid))
#define BLOCK(from, to) tr.block(__LINE__, (from), (to))
#define FOUND(i) tr.found(__LINE__, (i))
#define MISSING() tr.missing(__LINE__)

}  // namespace

Json SearchingAlgorithm::defaultInput() const {
    return Json::object({{"array", Json::array({3, 8, 14, 21, 27, 35, 42, 56, 63, 77})}, {"target", 42}});
}

ValidationResult SearchingAlgorithm::validate(const Json& input) const {
    std::vector<int> values;
    ValidationResult r = InputValidator::integerArray(input["array"], "array", 1, kMaxElements, -999, 999, values);
    if (!r.ok) return r;
    long long target = 0;
    r = InputValidator::integerInRange(input["target"], "target", -999, 999, target);
    if (!r.ok) return r;
    return requiresSorted() ? InputValidator::sortedAscending(values) : ValidationResult::success();
}

Json SearchingAlgorithm::run(const Json& input, StepRecorder& rec) const {
    std::vector<int> a;
    for (const Json& v : input["array"].items()) a.push_back(static_cast<int>(v.asInt()));
    int target = static_cast<int>(input["target"].asInt());
    if (rec.enabled())
        rec.emit("init", 0, "Searching for " + std::to_string(target) + " in " + std::to_string(a.size()) + " elements",
                 Json::object({{"arr", Json::fromVector(a)}, {"target", target}, {"found", nullptr}}));
    int index = search(a, target, rec);
    return Json::object({{"found", index >= 0}, {"index", index}, {"target", target}});
}

Json SearchingAlgorithm::scaledInput(std::size_t n, bool worst) const {
    Json arr = Json::array();
    for (std::size_t i = 0; i < n; ++i) arr.push(static_cast<long long>(i * 2));
    long long target = worst ? static_cast<long long>(n * 2 - 1) : static_cast<long long>(((n * 7) / 11) * 2);
    return Json::object({{"array", arr}, {"target", target}});
}

// ==== BEGIN linear_search ====
int LinearSearch::search(const std::vector<int>& a, int target, StepRecorder& rec) const {
    SearchTrace tr(rec, a, target);
    for (int i = 0; i < static_cast<int>(a.size()); ++i) {
        INSPECT(i);
        if (a[i] == target) {
            FOUND(i);
            return i;
        }
    }
    MISSING();
    return -1;
}
// ==== END linear_search ====

// ==== BEGIN binary_search ====
int BinarySearch::search(const std::vector<int>& a, int target, StepRecorder& rec) const {
    SearchTrace tr(rec, a, target);
    int low = 0, high = static_cast<int>(a.size()) - 1;
    while (low <= high) {
        int mid = low + (high - low) / 2;
        BOUNDS(low, high, mid);
        INSPECT(mid);
        if (a[mid] == target) {
            FOUND(mid);
            return mid;
        }
        if (a[mid] < target) low = mid + 1;
        else high = mid - 1;
    }
    MISSING();
    return -1;
}
// ==== END binary_search ====

// ==== BEGIN jump_search ====
int JumpSearch::search(const std::vector<int>& a, int target, StepRecorder& rec) const {
    SearchTrace tr(rec, a, target);
    const int n = static_cast<int>(a.size());
    const int step = std::max(1, static_cast<int>(std::sqrt(static_cast<double>(n))));
    int prev = 0, next = step;
    while (prev < n) {
        int blockEnd = std::min(next, n) - 1;
        BLOCK(prev, blockEnd);
        INSPECT(blockEnd);
        if (a[blockEnd] >= target) break;
        prev = next;
        next += step;
    }
    if (prev >= n) {
        MISSING();
        return -1;
    }
    for (int i = prev; i < std::min(next, n); ++i) {
        INSPECT(i);
        if (a[i] == target) {
            FOUND(i);
            return i;
        }
        if (a[i] > target) break;
    }
    MISSING();
    return -1;
}
// ==== END jump_search ====

void registerSearchingAlgorithms(AlgorithmManager& manager) {
    manager.add(std::make_unique<LinearSearch>());
    manager.add(std::make_unique<BinarySearch>());
    manager.add(std::make_unique<JumpSearch>());
}

}  // namespace bf
