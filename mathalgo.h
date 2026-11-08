#pragma once
#include "algorithm.h"

namespace bf {

class EuclideanGcd : public Algorithm {
public:
    EuclideanGcd() : Algorithm({"gcd", "Euclidean GCD", "math", "gcd", {"O(1)", "O(log n)", "O(log n)", "O(1)"}}) {}
    Json defaultInput() const override { return Json::object({{"a", 1071}, {"b", 462}}); }
    ValidationResult validate(const Json& input) const override;
    Json run(const Json& input, StepRecorder& rec) const override;
};

class SieveOfEratosthenes : public Algorithm {
public:
    SieveOfEratosthenes()
        : Algorithm({"sieve", "Sieve of Eratosthenes", "math", "sieve", {"O(n log log n)", "O(n log log n)", "O(n log log n)", "O(n)"}}) {}
    Json defaultInput() const override { return Json::object({{"n", 60}}); }
    ValidationResult validate(const Json& input) const override;
    Json run(const Json& input, StepRecorder& rec) const override;
    bool supportsScaling() const override { return true; }
    std::vector<std::size_t> scalingSizes() const override { return {100, 200, 400, 800, 1600, 3200}; }
    Json scaledInput(std::size_t n, bool) const override { return Json::object({{"n", n}}); }
};

}  // namespace bf
