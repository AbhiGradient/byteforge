#pragma once
#include <vector>

#include "algorithm.h"

namespace bf {

// Abstract intermediate class for recursive algorithms visualised as a call tree.
class RecursionAlgorithm : public Algorithm {
public:
    RecursionAlgorithm(const std::string& id, const std::string& name, Complexity complexity)
        : Algorithm({id, name, "recursion", "calltree", std::move(complexity)}) {}

    ValidationResult validate(const Json& input) const override;
    bool supportsScaling() const override { return true; }
    Json scaledInput(std::size_t n, bool) const override { return Json::object({{"n", n}}); }

protected:
    virtual long long maxN() const = 0;
};

class FactorialAlgorithm : public RecursionAlgorithm {
public:
    FactorialAlgorithm() : RecursionAlgorithm("factorial", "Factorial (Recursion)", {"O(n)", "O(n)", "O(n)", "O(n)"}) {}
    Json defaultInput() const override { return Json::object({{"n", 5}}); }
    Json run(const Json& input, StepRecorder& rec) const override;
    std::vector<std::size_t> scalingSizes() const override { return {4, 8, 12, 16, 20}; }
protected:
    long long maxN() const override { return 20; }
};

class FibonacciAlgorithm : public RecursionAlgorithm {
public:
    FibonacciAlgorithm()
        : RecursionAlgorithm("fibonacci", "Fibonacci (Recursion)", {"O(2^n)", "O(2^n)", "O(2^n)", "O(n)"}) {}
    Json defaultInput() const override { return Json::object({{"n", 6}}); }
    Json run(const Json& input, StepRecorder& rec) const override;
    std::vector<std::size_t> scalingSizes() const override { return {8, 12, 16, 20, 24}; }
protected:
    long long maxN() const override { return 12; }
};

}  // namespace bf
