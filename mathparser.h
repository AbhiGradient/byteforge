#pragma once
#include <string>
#include <vector>

#include "json.h"

namespace bf {

struct MathResult {
    bool ok = false;
    double value = 0.0;
    std::string formatted;
    std::string error;
    std::vector<std::string> tokens;
    std::vector<std::string> postfix;
    Json toJson() const;
};

// Safe arithmetic evaluator based on the Shunting Yard algorithm.
// Supports + - * / % ^ (and **), parentheses, decimals and unary signs.
// It never executes user code: the input is tokenised and evaluated as data.
class ExpressionEvaluator {
public:
    static constexpr std::size_t kMaxLength = 200;
    MathResult evaluate(const std::string& expression) const;
    static std::string format(double value);
};

}  // namespace bf
