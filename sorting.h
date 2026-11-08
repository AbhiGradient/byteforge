#pragma once
#include <vector>

#include "algorithm.h"

namespace bf {

// Abstract intermediate class: owns validation, input handling and the
// template method run(); concrete sorts only override sort().
class SortingAlgorithm : public Algorithm {
public:
    static constexpr std::size_t kMaxElements = 40;

    SortingAlgorithm(const std::string& id, const std::string& name, Complexity complexity)
        : Algorithm({id, name, "sorting", "bars", std::move(complexity)}) {}

    Json defaultInput() const override;
    ValidationResult validate(const Json& input) const override;
    Json run(const Json& input, StepRecorder& rec) const override;

    bool supportsScaling() const override { return true; }
    std::vector<std::size_t> scalingSizes() const override { return {16, 32, 64, 128, 256, 512}; }
    Json scaledInput(std::size_t n, bool worst) const override;

protected:
    virtual void sort(std::vector<int>& a, StepRecorder& rec) const = 0;
};

class BubbleSort : public SortingAlgorithm {
public:
    BubbleSort() : SortingAlgorithm("bubble_sort", "Bubble Sort", {"O(n)", "O(n^2)", "O(n^2)", "O(1)"}) {}
protected:
    void sort(std::vector<int>& a, StepRecorder& rec) const override;
};

class SelectionSort : public SortingAlgorithm {
public:
    SelectionSort() : SortingAlgorithm("selection_sort", "Selection Sort", {"O(n^2)", "O(n^2)", "O(n^2)", "O(1)"}) {}
protected:
    void sort(std::vector<int>& a, StepRecorder& rec) const override;
};

class InsertionSort : public SortingAlgorithm {
public:
    InsertionSort() : SortingAlgorithm("insertion_sort", "Insertion Sort", {"O(n)", "O(n^2)", "O(n^2)", "O(1)"}) {}
protected:
    void sort(std::vector<int>& a, StepRecorder& rec) const override;
};

class MergeSort : public SortingAlgorithm {
public:
    MergeSort() : SortingAlgorithm("merge_sort", "Merge Sort", {"O(n log n)", "O(n log n)", "O(n log n)", "O(n)"}) {}
protected:
    void sort(std::vector<int>& a, StepRecorder& rec) const override;
};

class QuickSort : public SortingAlgorithm {
public:
    QuickSort() : SortingAlgorithm("quick_sort", "Quick Sort", {"O(n log n)", "O(n log n)", "O(n^2)", "O(log n)"}) {}
protected:
    void sort(std::vector<int>& a, StepRecorder& rec) const override;
};

class HeapSort : public SortingAlgorithm {
public:
    HeapSort() : SortingAlgorithm("heap_sort", "Heap Sort", {"O(n log n)", "O(n log n)", "O(n log n)", "O(1)"}) {}
protected:
    void sort(std::vector<int>& a, StepRecorder& rec) const override;
};

}  // namespace bf
