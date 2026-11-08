#include "mathalgo.h"

#include <vector>

namespace bf {

namespace {
#define STEP(type, msg, data) do { if (rec.enabled()) rec.emit((type), __LINE__, (msg), (data)); } while (0)
std::string num(long long v) { return std::to_string(v); }
}  // namespace

ValidationResult EuclideanGcd::validate(const Json& input) const {
    long long a = 0, b = 0;
    ValidationResult r = InputValidator::integerInRange(input["a"], "a", 0, 1000000000, a);
    if (!r.ok) return r;
    r = InputValidator::integerInRange(input["b"], "b", 0, 1000000000, b);
    if (!r.ok) return r;
    if (a == 0 && b == 0) return ValidationResult::failure("gcd(0, 0) is undefined: at least one number must be positive.");
    return ValidationResult::success();
}

// ==== BEGIN gcd ====
Json EuclideanGcd::run(const Json& input, StepRecorder& rec) const {
    long long a = input["a"].asInt();
    long long b = input["b"].asInt();
    const long long originalA = a, originalB = b;
    Json rows = Json::array();
    STEP("init", "Compute gcd(" + num(a) + ", " + num(b) + ") with repeated division", Json::object({{"rows", rows}, {"a", a}, {"b", b}}));
    while (b != 0) {
        long long q = a / b;
        long long r = a % b;
        ++rec.stats().operations;
        ++rec.stats().comparisons;
        rows.push(Json::object({{"a", a}, {"b", b}, {"q", q}, {"r", r}}));
        STEP("divide", num(a) + " = " + num(b) + " x " + num(q) + " + " + num(r), Json::object({{"rows", rows}, {"a", a}, {"b", b}, {"q", q}, {"r", r}}));
        a = b;
        b = r;
    }
    STEP("done", "Remainder is 0, so gcd(" + num(originalA) + ", " + num(originalB) + ") = " + num(a),
         Json::object({{"rows", rows}, {"gcd", a}}));
    return Json::object({{"gcd", a}, {"iterations", rows.size()}, {"lcm", a == 0 ? Json(0) : Json((originalA / a) * originalB)}});
}
// ==== END gcd ====

ValidationResult SieveOfEratosthenes::validate(const Json& input) const {
    long long n = 0;
    return InputValidator::integerInRange(input["n"], "n", 2, 200, n);
}

// ==== BEGIN sieve ====
Json SieveOfEratosthenes::run(const Json& input, StepRecorder& rec) const {
    const int n = static_cast<int>(input["n"].asInt());
    std::vector<bool> composite(static_cast<std::size_t>(n) + 1, false);
    STEP("init", "Write down every number from 2 to " + num(n), Json::object({{"n", n}, {"cells", Json::array()}}));
    for (int p = 2; static_cast<long long>(p) * p <= n; ++p) {
        ++rec.stats().comparisons;
        ++rec.stats().operations;
        if (composite[p]) continue;
        STEP("select", num(p) + " is not crossed out, so it is prime", Json::object({{"p", p}, {"cells", Json::array({Json::array({p, 1})})}}));
        for (int m = p * p; m <= n; m += p) {
            if (!composite[m]) {
                composite[m] = true;
                ++rec.stats().writes;
                ++rec.stats().operations;
                STEP("mark", "Cross out " + num(m) + " (multiple of " + num(p) + ")", Json::object({{"p", p}, {"m", m}, {"cells", Json::array({Json::array({m, 2})})}}));
            }
        }
    }
    Json primes = Json::array();
    Json confirm = Json::array();
    for (int k = 2; k <= n; ++k)
        if (!composite[k]) {
            primes.push(k);
            confirm.push(Json::array({k, 1}));
        }
    STEP("done", "Every number left standing is prime: " + num(primes.size()) + " primes up to " + num(n), Json::object({{"p", nullptr}, {"cells", confirm}}));
    return Json::object({{"primes", primes}, {"count", primes.size()}});
}
// ==== END sieve ====

void registerMathAlgorithms(AlgorithmManager& manager) {
    manager.add(std::make_unique<EuclideanGcd>());
    manager.add(std::make_unique<SieveOfEratosthenes>());
}

}  // namespace bf
