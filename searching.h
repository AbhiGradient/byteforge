#pragma once
#include <vector>

#include "algorithm.h"

namespace bf {


// Abstract intermediate class shared by Linear, Binary and Jump search.
class SearchingAlgorithm : public Algorithm {
public:
    static constexpr std::size_t kMaxElements = 64;

    SearchingAlgorithm(const std::string& id, const std::string& name, Complexity complexity)
        : Algorithm({id, name, "searching", "cells", std::move(complexity)}) {}

    Json defaultInput() const override;
    ValidationResult validate(const Json& input) const override;
    Json run(const Json& input, StepRecorder& rec) const override;

    bool supportsScaling() const override { return true; }
    std::vector<std::size_t> scalingSizes() const override { return {64, 256, 1024, 4096, 16384, 65536}; }
    Json scaledInput(std::size_t n, bool worst) const override;

protected:
    virtual bool requiresSorted() const { return false; }
    virtual int search(const std::vector<int>& a, int target, StepRecorder& rec) const = 0;
};

class LinearSearch : public SearchingAlgorithm {
public:
    LinearSearch() : SearchingAlgorithm("linear_search", "Linear Search", {"O(1)", "O(n)", "O(n)", "O(1)"}) {}
protected:
    int search(const std::vector<int>& a, int target, StepRecorder& rec) const override;
};

class BinarySearch : public SearchingAlgorithm {
public:
    BinarySearch() : SearchingAlgorithm("binary_search", "Binary Search", {"O(1)", "O(log n)", "O(log n)", "O(1)"}) {}
protected:
    bool requiresSorted() const override { return true; }
    int search(const std::vector<int>& a, int target, StepRecorder& rec) const override;
};

class JumpSearch : public SearchingAlgorithm {
public:
    JumpSearch() : SearchingAlgorithm("jump_search", "Jump Search", {"O(1)", "O(sqrt n)", "O(sqrt n)", "O(1)"}) {}
protected:
    bool requiresSorted() const override { return true; }
    int search(const std::vector<int>& a, int target, StepRecorder& rec) const override;
};

}  // namespace bf
