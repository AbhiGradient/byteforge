#pragma once
#include <iosfwd>

#include "algorithm.h"

namespace bf {

// Runs the built-in correctness suite against every algorithm. Returns the
// number of failed checks (0 means everything passed).
int runSelfTest(const AlgorithmManager& manager, std::ostream& out);

}  // namespace bf
