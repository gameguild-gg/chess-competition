# minimum version
cmake_minimum_required(VERSION 3.16)

project(chess CXX)
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Disable Emscripten's built-in SDL port so our CPM-fetched SDL2 is used
if(EMSCRIPTEN)
    add_compile_options(-sUSE_SDL=0)
    add_link_options(-sUSE_SDL=0)
endif()

# set the output directory
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

set(FETCHCONTENT_QUIET FALSE)
include(cmake/get_cpm.cmake)

# set flag to compile only the chessvalidator
option(CHESS_VALIDATOR_ONLY "Compile only the chess validator" OFF)

CPMAddPackage("gh:TheLartians/Format.cmake@1.8.3")

# add external chess lib to use as a validator for the tools
CPMAddPackage(
        NAME disservin
        GITHUB_REPOSITORY InfiniBrains/chess-library
        DOWNLOAD_ONLY YES
        GIT_TAG master
        GIT_SHALLOW TRUE
        GIT_PROGRESS TRUE
)
include_directories(${disservin_SOURCE_DIR}/include)

# add magic_enum lib
CPMAddPackage(
        NAME magic_enum
        VERSION 0.9.5
        GITHUB_REPOSITORY Neargye/magic_enum
        DOWNLOAD_ONLY YES
        OPTIONS
        "MAGIC_ENUM_BUILD_EXAMPLES OFF"
        "MAGIC_ENUM_BUILD_TESTS OFF"
        "MAGIC_ENUM_BUILD_INSTALL OFF"
        GIT_PROGRESS TRUE
        GIT_SHALLOW TRUE
)
include_directories(${magic_enum_SOURCE_DIR}/include)

IF(NOT CHESS_VALIDATOR_ONLY)

    CPMAddPackage(
            NAME SDL2
            GITHUB_REPOSITORY libsdl-org/SDL
            GIT_TAG release-2.32.10
            OPTIONS "SDL2_DISABLE_INSTALL ON"
            "SDL_WERROR OFF"
            "SDL_TEST OFF"
    )
    find_package(SDL2 REQUIRED)
    if(SDL2_ADDED)
        file(GLOB SDL_HEADERS "${SDL_SOURCE_DIR}/include/*.h")

        # Create a target that copies headers at build time, when they change
        add_custom_target(
                sdl_copy_headers_in_build_dir
                COMMAND ${CMAKE_COMMAND} -E copy_directory "${SDL_SOURCE_DIR}/include"
                "${CMAKE_BINARY_DIR}/SDLHeaders/SDL2"
                DEPENDS ${SDL_HEADERS}
        )

        # Make SDL depend from it
        add_dependencies(SDL2 sdl_copy_headers_in_build_dir)

        # And add the directory where headers have been copied as an interface include dir
        target_include_directories(SDL2 INTERFACE "${CMAKE_BINARY_DIR}/SDLHeaders")

        set(SDL2_INCLUDE_DIR ${SDL2_SOURCE_DIR}/include)
    endif()
    # Ensure SDL2 include dir is always set (Emscripten's find_package may leave it empty)
    if(NOT SDL2_INCLUDE_DIR OR SDL2_INCLUDE_DIR STREQUAL "")
        set(SDL2_INCLUDE_DIR ${SDL2_SOURCE_DIR}/include)
    endif()
    include_directories(${SDL2_INCLUDE_DIR})

    # NanoSVG - header-only SVG parser and rasterizer
    CPMAddPackage(
            NAME nanosvg
            GITHUB_REPOSITORY memononen/nanosvg
            GIT_TAG master
            DOWNLOAD_ONLY YES
    )
    include_directories(${nanosvg_SOURCE_DIR}/src)

    # add imgui
    CPMAddPackage(
            NAME IMGUI
            URL "https://github.com/ocornut/imgui/archive/refs/tags/v1.92.5.zip"
    )
    IF(IMGUI_ADDED)
        add_library(IMGUI STATIC)

        target_sources( IMGUI
                PRIVATE
                ${IMGUI_SOURCE_DIR}/imgui_demo.cpp
                ${IMGUI_SOURCE_DIR}/imgui_draw.cpp
                ${IMGUI_SOURCE_DIR}/imgui_tables.cpp
                ${IMGUI_SOURCE_DIR}/imgui_widgets.cpp
                ${IMGUI_SOURCE_DIR}/imgui.cpp

                PRIVATE
                ${IMGUI_SOURCE_DIR}/backends/imgui_impl_sdlrenderer2.cpp
                ${IMGUI_SOURCE_DIR}/backends/imgui_impl_sdl2.cpp
                ${IMGUI_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp
        )
        target_include_directories( IMGUI
                PUBLIC ${IMGUI_SOURCE_DIR}
                PUBLIC ${IMGUI_SOURCE_DIR}/backends
        )
        if(SDL2_ADDED)
            target_include_directories(IMGUI BEFORE PRIVATE ${SDL2_SOURCE_DIR}/include)
        else()
            target_include_directories(IMGUI BEFORE PRIVATE ${SDL2_INCLUDE_DIR})
        endif()
        if(EMSCRIPTEN)
            target_link_libraries(IMGUI PUBLIC SDL2-static ${CMAKE_DL_LIBS})
        else()
            find_package(OpenGL REQUIRED)
            target_link_libraries(IMGUI PUBLIC ${OPENGL_gl_LIBRARY} SDL2 ${CMAKE_DL_LIBS})
        endif()
        if(SDL2_ADDED)
            add_dependencies(IMGUI sdl_copy_headers_in_build_dir)
        endif()
    ENDIF()
    include_directories(${IMGUI_SOURCE_DIR} ${IMGUI_SOURCE_DIR}/backends)

endif() # NOT CHESS_VALIDATOR_ONLY

# chess library
file(GLOB_RECURSE CHESS_BOT_FILES CONFIGURE_DEPENDS "chess-bot/*.cpp" "chess-bot/*.h")
add_library(chessbot STATIC ${CHESS_BOT_FILES})
set_target_properties(chessbot PROPERTIES LINKER_LANGUAGE CXX)
include_directories(chess-bot)

# chess cli
file(GLOB_RECURSE CHESS_CLI_FILES CONFIGURE_DEPENDS "chess-cli/*.cpp" "chess-cli/*.h")
add_executable(chesscli ${CHESS_CLI_FILES})
target_link_libraries(chesscli PUBLIC chessbot)

if(NOT CHESS_VALIDATOR_ONLY)
# chess gui
file(GLOB_RECURSE CHESS_GUI_FILES CONFIGURE_DEPENDS "chess-gui/*.cpp" "chess-gui/*.h")
add_executable(chessgui ${CHESS_GUI_FILES})
if(EMSCRIPTEN)
    target_link_libraries(chessgui PUBLIC chessbot IMGUI SDL2-static)
else()
    target_link_libraries(chessgui PUBLIC chessbot IMGUI SDL2::SDL2)
endif()
endif() # NOT CHESS_VALIDATOR_ONLY

# Emscripten / WebAssembly targets
if(EMSCRIPTEN)
    # GUI: build as HTML with ASYNCIFY for the main loop
    if(NOT CHESS_VALIDATOR_ONLY)
        set_target_properties(chessgui PROPERTIES SUFFIX ".html")
        target_link_options(chessgui PRIVATE
            -sASYNCIFY
            -sASYNCIFY_STACK_SIZE=65536
            -sALLOW_MEMORY_GROWTH=1
            --shell-file ${CMAKE_SOURCE_DIR}/chess-gui/shell.html
        )
    endif()

    # CLI: build as HTML with custom shell (no prompt() for stdin)
    set_target_properties(chesscli PROPERTIES SUFFIX ".html")
    target_link_options(chesscli PRIVATE
        -sALLOW_MEMORY_GROWTH=1
        -sEXIT_RUNTIME=1
        -sINVOKE_RUN=0
        "-sEXPORTED_RUNTIME_METHODS=['callMain']"
        --shell-file ${CMAKE_SOURCE_DIR}/chess-cli/shell.html
    )

    # WASM library: expose Move() to JavaScript via Embind
    add_executable(chesswasm chess-wasm/bindings.cpp)
    target_link_libraries(chesswasm PUBLIC chessbot)
    set_target_properties(chesswasm PROPERTIES SUFFIX ".js")
    target_link_options(chesswasm PRIVATE
        -lembind
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sEXPORT_NAME=ChessBot
        -sALLOW_MEMORY_GROWTH=1
        -sENVIRONMENT=web,worker
    )
endif()

CPMAddPackage(
        NAME CPMLicenses.cmake
        GITHUB_REPOSITORY cpm-cmake/CPMLicenses.cmake
        VERSION 0.0.5
)
write_license_disclaimer("third_party.txt" "${CPM_PACKAGES}")