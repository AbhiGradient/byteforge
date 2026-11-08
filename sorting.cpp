#include "sorting.h"

#include <algorithm>
#include <numeric>

namespace bf {

namespace {

// Records visualizer events for the sorting algorithms. Counters are always
// updated; steps are only built when the recorder is enabled.
class SortTrace {
public:
    SortTrace(StepRecorder& rec, const std::vector<int>& a) : rec_(rec), a_(a) {}

    void compare(int line, int i, int j) {
        count(rec_.stats().comparisons);
        if (!rec_.enabled()) return;
        rec_.emit("compare", line,
                  "Compare a[" + std::to_string(i) + "]=" + std::to_string(a_[i]) + " with a[" +
                      std::to_string(j) + "]=" + std::to_string(a_[j]),
                  Json::object({{"cmp", Json::array({i, j})}}));
    }
    void compareKey(int line, int j, int key) {
        count(rec_.stats().comparisons);
        if (!rec_.enabled()) return;
        rec_.emit("compare", line, "Compare a[" + std::to_string(j) + "]=" + std::to_string(a_[j]) +
                                       " with key " + std::to_string(key),
                  Json::object({{"cmp", Json::array({j})}}));
    }
    void compareAux(int line, int i, int j, const std::vector<int>& tmp) {
        count(rec_.stats().comparisons);
        if (!rec_.enabled()) return;
        rec_.emit("compare", line,
                  "Compare left " + std::to_string(tmp[i]) + " with right " + std::to_string(tmp[j]),
                  Json::object({{"cmpAux", Json::array({i, j})}}));
    }
    void swapped(int line, int i, int j) {
        count(rec_.stats().swaps);
        if (!rec_.enabled()) return;
        rec_.emit("swap", line, "Swap a[" + std::to_string(i) + "] and a[" + std::to_string(j) + "]",
                  Json::object({{"arr", Json::fromVector(a_)}, {"swap", Json::array({i, j})}}));
    }
    void wrote(int line, int idx) {
        count(rec_.stats().writes);
        if (!rec_.enabled()) return;
        rec_.emit("set", line, "Write " + std::to_string(a_[idx]) + " to a[" + std::to_string(idx) + "]",
                  Json::object({{"arr", Json::fromVector(a_)}, {"set", Json::array({idx})}}));
    }
    void markSorted(int line, int lo, int hi) {
        if (!rec_.enabled()) {
            return;
        }
        for (int k = lo; k <= hi; ++k)
            if (std::find(sorted_.begin(), sorted_.end(), k) == sorted_.end()) sorted_.push_back(k);
        std::sort(sorted_.begin(), sorted_.end());
        std::string msg = lo == hi ? "a[" + std::to_string(lo) + "] is in its final position"
                                   : "a[" + std::to_string(lo) + ".." + std::to_string(hi) + "] is sorted";
        rec_.emit("sorted", line, msg,
                  Json::object({{"sorted", Json::fromVector(sorted_)}, {"min", nullptr}, {"key", nullptr}}));
    }
    void note(int line, const std::string& message, Json data = Json::object()) {
        if (rec_.enabled()) rec_.emit("note", line, message, std::move(data));
    }
    void range(int line, int lo, int hi, const std::string& message) {
        if (rec_.enabled()) rec_.emit("range", line, message, Json::object({{"range", Json::array({lo, hi})}}));
    }
    void pivot(int line, int idx) {
        if (rec_.enabled())
            rec_.emit("pivot", line, "Choose pivot a[" + std::to_string(idx) + "]=" + std::to_string(a_[idx]),
                      Json::object({{"pivot", idx}}));
    }
    void clearPivot(int line) {
        if (rec_.enabled()) rec_.emit("note", line, "Partition finished", Json::object({{"pivot", nullptr}}));
    }
    void minimum(int line, int idx) {
        if (rec_.enabled())
            rec_.emit("min", line, "Current minimum is a[" + std::to_string(idx) + "]=" + std::to_string(a_[idx]),
                      Json::object({{"min", idx}}));
    }
    void key(int line, int value, int index) {
        if (rec_.enabled())
            rec_.emit("key", line, "Take key " + std::to_string(value) + " from a[" + std::to_string(index) + "]",
                      Json::object({{"key", value}, {"keyIndex", index}}));
    }
    void clearKey(int line) {
        if (rec_.enabled()) rec_.emit("note", line, "Key placed", Json::object({{"key", nullptr}}));
    }
    void aux(int line, const std::vector<int>& tmp, int lo, int hi) {
        if (!rec_.enabled()) return;
        Json sub = Json::array();
        for (int k = lo; k <= hi; ++k) sub.push(tmp[k]);
        rec_.emit("copy", line, "Copy a[" + std::to_string(lo) + ".." + std::to_string(hi) + "] to a temporary buffer",
                  Json::object({{"aux", sub}, {"auxRange", Json::array({lo, hi})}}));
    }
    void clearAux(int line) {
        if (rec_.enabled())
            rec_.emit("note", line, "Merge complete", Json::object({{"aux", nullptr}, {"auxRange", nullptr}}));
    }
    void heap(int line, int size) {
        if (rec_.enabled())
            rec_.emit("heap", line, "Heap size is now " + std::to_string(size), Json::object({{"heapSize", size}}));
    }

private:
    void count(long long& counter) {
        ++counter;
        ++rec_.stats().operations;
    }
    StepRecorder& rec_;
    const std::vector<int>& a_;
    std::vector<int> sorted_;
};

#define CMP(i, j) tr.compare(__LINE__, (i), (j))
#define CMP_KEY(j, key) tr.compareKey(__LINE__, (j), (key))
#define CMP_AUX(i, j, tmp) tr.compareAux(__LINE__, (i), (j), (tmp))
#define SWAPPED(i, j) tr.swapped(__LINE__, (i), (j))
#define WROTE(i) tr.wrote(__LINE__, (i))
#define SORTED(i) tr.markSorted(__LINE__, (i), (i))
#define SORTED_RANGE(lo, hi) tr.markSorted(__LINE__, (lo), (hi))
#define NOTE(msg) tr.note(__LINE__, (msg))
#define RANGE(lo, hi, msg) tr.range(__LINE__, (lo), (hi), (msg))
#define PIVOT(i) tr.pivot(__LINE__, (i))
#define CLEAR_PIVOT() tr.clearPivot(__LINE__)
#define MINIMUM(i) tr.minimum(__LINE__, (i))
#define KEY(v, i) tr.key(__LINE__, (v), (i))
#define CLEAR_KEY() tr.clearKey(__LINE__)
#define AUX(tmp, lo, hi) tr.aux(__LINE__, (tmp), (lo), (hi))
#define CLEAR_AUX() tr.clearAux(__LINE__)
#define HEAP(n) tr.heap(__LINE__, (n))

std::vector<int> toVector(const Json& array) {
    std::vector<int> out;
    for (const Json& v : array.items()) out.push_back(static_cast<int>(v.asInt()));
    return out;
}

}  // namespace

// ------------------------- SortingAlgorithm (base) --------------------------

Json SortingAlgorithm::defaultInput() const {
    return Json::object({{"array", Json::array({29, 10, 14, 37, 13, 5, 42, 18})}});
}

ValidationResult SortingAlgorithm::validate(const Json& input) const {
    std::vector<int> values;
    return InputValidator::integerArray(input["array"], "array", 1, kMaxElements, -999, 999, values);
}

Json SortingAlgorithm::run(const Json& input, StepRecorder& rec) const {
    std::vector<int> a = toVector(input["array"]);
    if (rec.enabled())
        rec.emit("init", 0, "Initial array with " + std::to_string(a.size()) + " elements",
                 Json::object({{"arr", Json::fromVector(a)}, {"sorted", Json::array()}}));
    sort(a, rec);
    if (rec.enabled()) {
        std::vector<int> all(a.size());
        std::iota(all.begin(), all.end(), 0);
        rec.emit("done", 0, "Array is sorted",
                 Json::object({{"arr", Json::fromVector(a)},
                               {"sorted", Json::fromVector(all)},
                               {"range", nullptr},
                               {"pivot", nullptr},
                               {"aux", nullptr},
                               {"auxRange", nullptr},
                               {"heapSize", nullptr},
                               {"min", nullptr},
                               {"key", nullptr}}));
    }
    return Json::object({{"sorted", Json::fromVector(a)}, {"isSorted", std::is_sorted(a.begin(), a.end())}});
}

Json SortingAlgorithm::scaledInput(std::size_t n, bool worst) const {
    Json arr = Json::array();
    unsigned long long x = 12345;
    for (std::size_t i = 0; i < n; ++i) {
        if (worst) {
            arr.push(static_cast<long long>(n - i));
        } else {
            x = (x * 1103515245ULL + 12345ULL) & 0x7fffffffULL;
            arr.push(static_cast<long long>(x % 1000));
        }
    }
    return Json::object({{"array", arr}});
}

// ==== BEGIN bubble_sort ====
void BubbleSort::sort(std::vector<int>& a, StepRecorder& rec) const {
    SortTrace tr(rec, a);
    const int n = static_cast<int>(a.size());
    for (int i = 0; i < n - 1; ++i) {
        bool swapped = false;
        for (int j = 0; j < n - 1 - i; ++j) {
            CMP(j, j + 1);
            if (a[j] > a[j + 1]) {
                std::swap(a[j], a[j + 1]); SWAPPED(j, j + 1);
                swapped = true;
            }
        }
        SORTED(n - 1 - i);
        if (!swapped) {
            NOTE("No swaps in this pass, the array is already sorted");
            break;
        }
    }
}
// ==== END bubble_sort ====

// ==== BEGIN selection_sort ====
void SelectionSort::sort(std::vector<int>& a, StepRecorder& rec) const {
    SortTrace tr(rec, a);
    const int n = static_cast<int>(a.size());
    for (int i = 0; i < n - 1; ++i) {
        int minIdx = i;
        MINIMUM(minIdx);
        for (int j = i + 1; j < n; ++j) {
            CMP(j, minIdx);
            if (a[j] < a[minIdx]) {
                minIdx = j;
                MINIMUM(minIdx);
            }
        }
        if (minIdx != i) {
            std::swap(a[i], a[minIdx]); SWAPPED(i, minIdx);
        }
        SORTED(i);
    }
}
// ==== END selection_sort ====

// ==== BEGIN insertion_sort ====
void InsertionSort::sort(std::vector<int>& a, StepRecorder& rec) const {
    SortTrace tr(rec, a);
    const int n = static_cast<int>(a.size());
    SORTED(0);
    for (int i = 1; i < n; ++i) {
        int key = a[i];
        KEY(key, i);
        int j = i - 1;
        while (j >= 0) {
            CMP_KEY(j, key);
            if (a[j] <= key) break;
            a[j + 1] = a[j]; WROTE(j + 1);
            --j;
        }
        a[j + 1] = key; WROTE(j + 1);
        SORTED_RANGE(0, i);
        CLEAR_KEY();
    }
}
// ==== END insertion_sort ====

// ==== BEGIN merge_sort ====
static void mergeHalves(std::vector<int>& a, std::vector<int>& tmp, int lo, int mid, int hi, SortTrace& tr) {
    for (int k = lo; k <= hi; ++k) tmp[k] = a[k];
    AUX(tmp, lo, hi);
    int i = lo, j = mid + 1;
    for (int k = lo; k <= hi; ++k) {
        if (i > mid) {
            a[k] = tmp[j++];
        } else if (j > hi) {
            a[k] = tmp[i++];
        } else {
            CMP_AUX(i, j, tmp);
            a[k] = (tmp[j] < tmp[i]) ? tmp[j++] : tmp[i++];
        }
        WROTE(k);
    }
    CLEAR_AUX();
}

static void mergeSortRange(std::vector<int>& a, std::vector<int>& tmp, int lo, int hi, SortTrace& tr) {
    if (lo >= hi) return;
    int mid = lo + (hi - lo) / 2;
    RANGE(lo, hi, "Split a[" + std::to_string(lo) + ".." + std::to_string(hi) + "] at index " + std::to_string(mid));
    mergeSortRange(a, tmp, lo, mid, tr);
    mergeSortRange(a, tmp, mid + 1, hi, tr);
    RANGE(lo, hi, "Merge a[" + std::to_string(lo) + ".." + std::to_string(mid) + "] and a[" + std::to_string(mid + 1) + ".." + std::to_string(hi) + "]");
    mergeHalves(a, tmp, lo, mid, hi, tr);
}

void MergeSort::sort(std::vector<int>& a, StepRecorder& rec) const {
    SortTrace tr(rec, a);
    std::vector<int> tmp(a.size());
    mergeSortRange(a, tmp, 0, static_cast<int>(a.size()) - 1, tr);
}
// ==== END merge_sort ====

// ==== BEGIN quick_sort ====
static int partitionLomuto(std::vector<int>& a, int lo, int hi, SortTrace& tr) {
    PIVOT(hi);
    int i = lo - 1;
    for (int j = lo; j < hi; ++j) {
        CMP(j, hi);
        if (a[j] < a[hi]) {
            ++i;
            if (i != j) {
                std::swap(a[i], a[j]); SWAPPED(i, j);
            }
        }
    }
    if (i + 1 != hi) {
        std::swap(a[i + 1], a[hi]); SWAPPED(i + 1, hi);
    }
    SORTED(i + 1);
    CLEAR_PIVOT();
    return i + 1;
}

static void quickSortRange(std::vector<int>& a, int lo, int hi, SortTrace& tr) {
    if (lo > hi) return;
    if (lo == hi) {
        SORTED(lo);
        return;
    }
    RANGE(lo, hi, "Partition a[" + std::to_string(lo) + ".." + std::to_string(hi) + "]");
    int p = partitionLomuto(a, lo, hi, tr);
    quickSortRange(a, lo, p - 1, tr);
    quickSortRange(a, p + 1, hi, tr);
}

void QuickSort::sort(std::vector<int>& a, StepRecorder& rec) const {
    SortTrace tr(rec, a);
    quickSortRange(a, 0, static_cast<int>(a.size()) - 1, tr);
}
// ==== END quick_sort ====

// ==== BEGIN heap_sort ====
static void siftDown(std::vector<int>& a, int size, int root, SortTrace& tr) {
    while (true) {
        int largest = root, left = 2 * root + 1, right = 2 * root + 2;
        if (left < size) {
            CMP(left, largest);
            if (a[left] > a[largest]) largest = left;
        }
        if (right < size) {
            CMP(right, largest);
            if (a[right] > a[largest]) largest = right;
        }
        if (largest == root) return;
        std::swap(a[root], a[largest]); SWAPPED(root, largest);
        root = largest;
    }
}

void HeapSort::sort(std::vector<int>& a, StepRecorder& rec) const {
    SortTrace tr(rec, a);
    const int n = static_cast<int>(a.size());
    HEAP(n);
    for (int i = n / 2 - 1; i >= 0; --i) siftDown(a, n, i, tr);
    NOTE("Max-heap built: the largest value is at the root");
    for (int end = n - 1; end > 0; --end) {
        std::swap(a[0], a[end]); SWAPPED(0, end);
        SORTED(end);
        HEAP(end);
        siftDown(a, end, 0, tr);
    }
    SORTED(0);
}
// ==== END heap_sort ====

void registerSortingAlgorithms(AlgorithmManager& manager) {
    manager.add(std::make_unique<BubbleSort>());
    manager.add(std::make_unique<SelectionSort>());
    manager.add(std::make_unique<InsertionSort>());
    manager.add(std::make_unique<MergeSort>());
    manager.add(std::make_unique<QuickSort>());
    manager.add(std::make_unique<HeapSort>());
}

}  // namespace bf
