#include "recursion.h"

namespace bf {

namespace {

// Records call/return events and the live call stack of a recursive function.
class CallTrace {
public:
    explicit CallTrace(StepRecorder& rec) : rec_(rec) {}

    int call(int line, const std::string& label, int parent, int depth) {
        int id = nextId_++;
        ++rec_.stats().calls;
        ++rec_.stats().operations;
        stack_.push_back(id);
        if (rec_.enabled())
            rec_.emit("call", line, "Call " + label,
                      Json::object({{"event", "call"},
                                    {"node", Json::object({{"id", id}, {"parent", parent}, {"label", label}, {"depth", depth}})},
                                    {"stack", Json::fromVector(stack_)}}));
        return id;
    }
    void ret(int line, int id, const std::string& label, long long value) {
        ++rec_.stats().operations;
        if (rec_.enabled())
            rec_.emit("return", line, label + " returns " + std::to_string(value),
                      Json::object({{"event", "return"}, {"id", id}, {"value", std::to_string(value)},
                                    {"stack", Json::fromVector(std::vector<int>(stack_.begin(), stack_.end() - 1))}}));
        stack_.pop_back();
    }
    void note(int line, const std::string& message) {
        if (rec_.enabled()) rec_.emit("note", line, message, Json::object({{"event", "note"}, {"stack", Json::fromVector(stack_)}}));
    }

private:
    StepRecorder& rec_;
    std::vector<int> stack_;
    int nextId_ = 0;
};

#define CALL(label, parent, depth) tr.call(__LINE__, (label), (parent), (depth))
#define RETURN(id, label, value) tr.ret(__LINE__, (id), (label), (value))
#define NOTE(msg) tr.note(__LINE__, (msg))

}  // namespace

ValidationResult RecursionAlgorithm::validate(const Json& input) const {
    long long n = 0;
    return InputValidator::integerInRange(input["n"], "n", 0, maxN(), n);
}

// ==== BEGIN factorial ====
static unsigned long long factorialRec(int n, int parent, int depth, CallTrace& tr) {
    int id = CALL("fact(" + std::to_string(n) + ")", parent, depth);
    if (n <= 1) {
        NOTE("Base case reached: fact(" + std::to_string(n) + ") = 1");
        RETURN(id, "fact(" + std::to_string(n) + ")", 1);
        return 1;
    }
    unsigned long long sub = factorialRec(n - 1, id, depth + 1, tr);
    unsigned long long result = static_cast<unsigned long long>(n) * sub;
    RETURN(id, "fact(" + std::to_string(n) + ")", static_cast<long long>(result));
    return result;
}

Json FactorialAlgorithm::run(const Json& input, StepRecorder& rec) const {
    CallTrace tr(rec);
    int n = static_cast<int>(input["n"].asInt());
    unsigned long long value = factorialRec(n, -1, 0, tr);
    return Json::object({{"n", n}, {"value", std::to_string(value)}, {"calls", rec.stats().calls}});
}
// ==== END factorial ====

// ==== BEGIN fibonacci ====
static long long fibonacciRec(int n, int parent, int depth, CallTrace& tr) {
    int id = CALL("fib(" + std::to_string(n) + ")", parent, depth);
    if (n < 2) {
        NOTE("Base case: fib(" + std::to_string(n) + ") = " + std::to_string(n));
        RETURN(id, "fib(" + std::to_string(n) + ")", n);
        return n;
    }
    long long left = fibonacciRec(n - 1, id, depth + 1, tr);
    long long right = fibonacciRec(n - 2, id, depth + 1, tr);
    RETURN(id, "fib(" + std::to_string(n) + ")", left + right);
    return left + right;
}

Json FibonacciAlgorithm::run(const Json& input, StepRecorder& rec) const {
    CallTrace tr(rec);
    int n = static_cast<int>(input["n"].asInt());
    long long value = fibonacciRec(n, -1, 0, tr);
    return Json::object({{"n", n}, {"value", std::to_string(value)}, {"calls", rec.stats().calls}});
}
// ==== END fibonacci ====

void registerRecursionAlgorithms(AlgorithmManager& manager) {
    manager.add(std::make_unique<FactorialAlgorithm>());
    manager.add(std::make_unique<FibonacciAlgorithm>());
}

}  // namespace bf
