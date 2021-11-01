(function(){
    // overall gravity toward center
    let to_center = 18;
    // closer to 1: free floating, closer to 0: lots of friction - atmospheric friction?
    let v_friction = 0.3;
    // how hard bubbles push one another away when touching
    let bounce = 0.7;
    // how hard bubbles push one another away when close
    let repulsion = 2;
    // thickness of bubble walls
    let bubble_wall = 5;
    // margin around bubbles
    let bubble_outer_margin = 4;
    // overall reduction of force
    let inertia = 0.5;
    // stickiness of background - forces less than this will be ignored
    let bg_friction = 0.4;
    // available colors
    const r_colors = [
        "black", "gray", "lightgray",
        "red", "deeppink", "crimson",
        "orange", "darkorange", "goldenrod", "brown",
        "yellow",
        "greenyellow",
        "green",
        "darkolivegreen", "darkseagreen",
        "darkturquoise",
        "darkcyan",
        "aqua",
        "blue",
        "darkslateblue",
        "purple"
    ];
    /////////
    // colors
    let sel_color = "rgba(255,255,128,128)";  // "#ffff80";
    // all bubbles
    let bubbles = [];
    let popped = [];
    let save_popped = true;
    let title = "";
    // start time for previous frame
    let t0 = new Date().getTime();
    //view
    let pan = [0, 0];
    let zoom = 1;
    let the_canvas = null;
    let the_context = null;
    // load/save
    function all_saves() {
        const data = localStorage.getItem("saves");
        if (data === null)
            return [];
        return JSON.parse(data);
    }
    function upd_saves(saves=null) {
        if (saves === null)
            saves = all_saves();
        saves.sort();
        localStorage.setItem("saves", JSON.stringify(saves))
        // update the dropdown
        const save_sel = document.getElementById("saves");
        save_sel.innerHTML = "";
        var opt = document.createElement("option");
        opt.innerText = "---";
        opt.setAttribute("value", "");
        save_sel.appendChild(opt);
        for (var n=0; n < saves.length; n++) {
            var opt = document.createElement("option");
            opt.innerText = saves[n];
            save_sel.appendChild(opt);
        }
    }
    function save(name="") {
        name = name || "default";
        const all = all_saves();
        const data = JSON.stringify({"bubbles": bubbles, "popped": popped});
        localStorage.setItem("save." + name, data);
        // make sure the save is listed
        if (all.indexOf(name) < 0) {
            all.push(name);
            upd_saves(all);
        }
    }
    function load(name="") {
        name = name || "default";
        title = name;
        const edt_title = document.getElementById("title");
        edt_title.value = name;
        const data = JSON.parse(localStorage.getItem("save." + name));
        if (data === null)
            return;
        bubbles = []
        for (var nb=0; nb < data.bubbles.length; nb++) {
            const b = data.bubbles[nb];
            if (b === null || b.x === null)
                continue;
            const b_new = new Bubble(b.x, b.y, b.r, b.color, b.text, b.fixed, b.weight, b.bounce)
            bubbles.push(b_new);
        }
        popped = data.popped;
    }
    function clear() {
        bubbles = []
        popped = [];
    }
    //
    function set_pan_zoom(px, py, z=0) {
        pan = [px, py];
        zoom = z || zoom;
        the_context.setTransform(zoom, 0, 0, zoom, pan[0], pan[1]);
    }
    // utilities
    function surface_tension(surface, fuzz) {
        let i = surface;
        let o = i;
        for (var n_fuzz=0; n_fuzz < fuzz; n_fuzz++) {
            o = []
            const ff = [[-2, 0.1], [-1, 0.25], [0, 0.3], [1, 0.25], [2, 0.1]];
            for (var n = 0; n < i.length; n++) {
                let v = 0;
                for (var nf = 0; nf < ff.length; nf++) {
                    const f0 = ff[nf][0];
                    const f1 = ff[nf][1];
                    v += i[(n + f0 + i.length) % i.length] * f1;
                }
                o.push(v);
            }
            i = o;
        }
        return o;
    }
    //
    class Bubble {
        constructor(x, y, r, color, text="", fixed=false, weight=1, bounce=1) {
            this.x = x;
            this.y = y;
            this.vx = 0;
            this.vy = 0;
            this.r = r;
            this.r2 = r*r;
            this.color = color;
            this.text = text;
            this.weight = weight;
            this.bounce = bounce;
            this.fixed = fixed;
            this.popped_at = null;
            // view-related
            this.dragging = false;
            this.selected = false;
            this.squish = [];
            this.change_size = 0;
            this.popping = 0;
            this.restore_surface();
        }
        restore_surface() {
            const sq = []
            for (var n=0; n < 100; n++)
                sq.push(this.r);
            this.squish = sq;
        }
        poke(depth, angle, other_d, other_r) {
            const npts = this.squish.length;
            const to_n = 6.284 / npts;
            const ai = Math.round(angle / to_n);
            let c = other_r;
            let b = this.r;
            let a = other_d;
            let w_poke = Math.acos((a*a + b*b - c*c) / (2*a*b));
            if (isNaN(w_poke))
                // entirely inside
                return;
            const max_sq = this.r * 0.85;
            function f(a) {
                var wx = (a - angle)/w_poke;
                var da = Math.cos(1.57 * wx);
                if (da < 0)
                    da = 0
                var dd = da**0.25 * depth;
                return Math.min(dd, max_sq);
            }
            const nr = Math.floor(w_poke / to_n + 0.5);
            for (var n=ai-nr; n <= ai+nr; n ++) {
                const n1 = (n + npts) % npts;
                this.squish[n1] -= f(n * 6.284 / npts);
            }
        }
        draw(ctx) {
            const r = this.r - bubble_outer_margin;
            ctx.beginPath();
            if (this.squish) {
                ctx.lineCap = "round";
                let npts = this.squish.length;
                let a = 0, da = 6.28318 / npts;
                for (var n=0; n < npts+1; n++) {
                    const x = this.x + (this.squish[n%npts] - bubble_outer_margin) * Math.cos(a);
                    const y = this.y + (this.squish[n%npts] - bubble_outer_margin) * Math.sin(a);
                    if (n === 0)
                        ctx.moveTo(x, y)
                    else
                        ctx.lineTo(x, y)
                    a += da;
                }
                if (this.selected)
                    ctx.closePath();
            } else {
                ctx.ellipse(this.x, this.y, r - bubble_wall, r - bubble_wall, 0, 0, 6.284);
                ctx.closePath();
            }
            if (this.popping) {
                // hm
            }
            else if (this.selected) {
                ctx.fillStyle = sel_color;
                ctx.fill()
            }
            const w_h = bubble_wall * Math.max(0.1, Math.log(4*this.weight));
            ctx.lineWidth = w_h;
            if (this.popping)
                ctx.lineWidth = 1;
            ctx.strokeStyle = this.color;
            ctx.stroke();
            if (this.fixed) {
                ctx.lineWidth = ctx.lineWidth / 3;
                ctx.strokeStyle = "white"
                ctx.setLineDash([4, 10])
                ctx.stroke();
                ctx.setLineDash([])
            }
            if (! this.popping) {
                ctx.textAlign = "center";
                ctx.fillStyle = this.selected ? 'black' : '#606060';
                let margin = 25;
                let lines = this.text.trim().split("\n");
                let line_height = 16;
                ctx.font = line_height + "px sans-serif";
                const max_lines = Math.floor((2*this.r - margin) / line_height);
                if (lines.length > max_lines)
                    lines = lines.slice(0, max_lines);
                let by = line_height*lines.length/2 - line_height*0.8;
                for (var nl=0; nl < lines.length; nl++) {
                    let line = lines[nl];
                    let bw = Math.sqrt(this.r2 - by*by)*2 - margin;
                    let tw = ctx.measureText(line).width;
                    if (tw > bw) {
                        line = line.substring(0, Math.floor((bw-8) * line.length / tw)) + "\u2026";
                    }
                    ctx.fillText(line, this.x, this.y - by);
                    by -= line_height;
                }
            }
        }
        forces(dt) {
            let fx=0, fy=0;
            const a = this;
            this.restore_surface();
            if (this.popping)
                return [0, 0];
            for (var nb=0; nb < bubbles.length; nb++){
                const b = bubbles[nb];
                if (a === b  ||  b.popping)
                    continue;
                const dx = b.x - a.x, dy = b.y - a.y;
                const r2 = dx*dx + dy*dy;
                // away from other bubbles
                const ab_r2 = a.r2 + b.r2 + 2*a.r*b.r;
                const closeness = r2 - ab_r2;
                const d = Math.sqrt(dx*dx+dy*dy);
                let f_a = 0;
                if (closeness < 0) {
                    // bounciness
                    f_a = Math.sqrt(-closeness) * bounce * this.bounce * dt;
                    // show bounce visually
                    const poke_angle = Math.atan2(dy, dx);
                    let poke_depth = a.r + b.r - d;
                    poke_depth /= 2;
                    this.poke(poke_depth, poke_angle, d, b.r);
                } else if (closeness < 10000) {
                    // mild repulsion
                    f_a = repulsion * dt * 10 / (closeness + 10);
                }
                if (f_a) {
                    fx -= f_a * dx/d;
                    fy -= f_a * dy/d;
                }
            }
            this.squish = surface_tension(this.squish, 3);
            if (this.dragging  ||  this.fixed  ||  this.popping)
                return [0, 0];
            // toward center
            const d0 = Math.sqrt(a.x*a.x + a.y*a.y);
            if (d0 > 30) {
                const f0c = dt * to_center * this.weight;
                fx -= f0c * a.x/d0;
                fy -= f0c * a.y/d0;
            }
            if (Math.abs(fx) < bg_friction)
                fx = 0;
            if (Math.abs(fy) < bg_friction)
                fy = 0;
            return [fx, fy];
        }
        move(dt, friction) {
            const force = this.forces(dt);
            this.vx += force[0];
            this.vy += force[1];
            this.x += this.vx * inertia;
            this.y += this.vy * inertia;
            this.vx *= friction;
            this.vy *= friction;
            if (this.change_size) {
                let amt = dt * 0.8 * this.change_size;
                if (Math.abs(amt) > Math.abs(this.change_size))
                    amt = this.change_size;
                this.r += amt;
                this.r2 = this.r**2;
                this.change_size -= amt;
            }
            if (this.popping) {
                const expand = 0.3 ** dt;
                this.r *= expand;
                this.r2 = this.r ** 2;
                this.popping *= expand;
                if (this.popping < 0.1) {
                    var nb = bubbles.indexOf(this);
                    const bbl = bubbles.splice(nb, 1);
                    bbl.popped_at = new Date().getTime();
                    if (save_popped)
                        popped.push(bbl);
                }
            }
        }
    }
    function overbubble(x, y) {
        for (var nb=0; nb < bubbles.length; nb++) {
            const b = bubbles[nb];
            const d2 = (x-b.x)*(x-b.x)+(y-b.y)*(y-b.y);
            if (d2 < b.r2) {
                if (b.squish) {
                    let clk_a = Math.atan2(y - b.y, x - b.x) * b.squish.length / 6.284;
                    clk_a = Math.floor((clk_a + b.squish.length) % b.squish.length);
                    const clk_r = b.squish[clk_a];
                    if (d2 < clk_r*clk_r)
                        return b;
                }
            }
        }
    }
    function draw_bubble_form(bubble, area) {
        function refresh() {
            if (! bubble.selected)
                return;
            var h = "";
            h += "<div class='title'>Edit Bubble Data</div>";
            area.innerHTML = h;
            // edit title
            const edit_text = document.createElement("textarea");
            edit_text.setAttribute("rows", "3");
            edit_text.value = bubble.text;
            edit_text.addEventListener("input", function() {
                bubble.text = edit_text.value;
            })
            area.appendChild(edit_text);
            area.appendChild(document.createElement("br"));
            // bigger/smaller
            const btn_smaller = document.createElement("button");
            btn_smaller.innerText = "smaller"
            btn_smaller.addEventListener("click", function() {
                bubble.change_size = -bubble.r * 0.10;
            });
            area.appendChild(btn_smaller);
            const btn_bigger = document.createElement("button");
            btn_bigger.innerText = "bigger"
            btn_bigger.addEventListener("click", function() {
                bubble.change_size = bubble.r * 0.10;
            });
            area.appendChild(btn_bigger);
            area.appendChild(document.createElement("br"));
            // weight
            const edit_weight = document.createElement("input");
            edit_weight.setAttribute("type", "number");
            edit_weight.value = bubble.weight.toFixed(1);
            function set_w(vw) {
                vw = Math.min(vw, 20);
                vw = Math.max(vw, 0.2);
                edit_weight.value = bubble.weight.toFixed(1);
                bubble.weight = vw;
            }
            edit_weight.addEventListener("change", function() {
                let vw = parseFloat(edit_weight.value);
                set_w(vw);
            })
            const btn_heavier = document.createElement("button");
            btn_heavier.innerText = "heavier"
            btn_heavier.addEventListener("click", function() {
                set_w(bubble.weight *= 1.2);
            });
            const btn_lighter = document.createElement("button");
            btn_lighter.innerText = "lighter"
            btn_lighter.addEventListener("click", function() {
                set_w(bubble.weight *= 0.8);
            });
            area.appendChild(btn_lighter);
            area.appendChild(edit_weight);
            area.appendChild(btn_heavier);
            area.appendChild(document.createElement("br"));
            // color
            const btn_color = document.createElement("button");
            btn_color.innerText = "color"
            btn_color.addEventListener("click", function() {
                let nc = r_colors.indexOf(bubble.color);
                bubble.color = r_colors[nc+1];
            });
            area.appendChild(btn_color);
            // pinned
            const btn_pinned = document.createElement("button");
            btn_pinned.innerText = "pinned"
            btn_pinned.addEventListener("click", function() {
                bubble.fixed = ! bubble.fixed;
            });
            area.appendChild(btn_pinned);
            // pop bubble
            const btn_pop = document.createElement("button");
            btn_pop.innerText = "pop"
            btn_pop.addEventListener("click", function() {
                bubble.popping = 1;
                bubble.restore_surface();
            });
            area.appendChild(btn_pop);
            //
            if (bubble.selected) {
                setTimeout(refresh, 60000);
            }
        }
        refresh();
    }
    function drag_and_select() {
        const canvas = the_canvas
        var onbubble = null;
        var start = null;
        var move00 = null, move0 = null, move1 = null;
        var pan0 = null;
        var clicked = false;
        var panel = document.getElementById("panel");
        // set up tools
        document.getElementById("zoom-in").addEventListener("click", function(){
            set_pan_zoom(pan[0], pan[1], zoom*1.25)
        });
        document.getElementById("zoom-out").addEventListener("click", function(){
            set_pan_zoom(pan[0], pan[1], zoom*(1/1.25))
        });
        const edt_title = document.getElementById("title");
        const save_sel = document.getElementById("saves");
        function title_change() {
            // title changed
            const edited = edt_title.value || "default";
            if (edited === title)
                return;
            if (edited === "") {
                edt_title.value = title;
                return;
            }
            const saves = all_saves();
            if (saves.indexOf(edited) >= 0) {
                // warn on overwrite
                if (! confirm("Are you sure you want to replace '" + edited + "'?"))
                    return;
            }
            // change title, rename saved data
            title = edited;
            let n = saves.indexOf(title);
            if (n >= 0)
                saves.splice(n, 1);
            saves.push(edited);
            upd_saves(saves);
            // save right away
            save(title);
            // select in drop-down
            save_sel.value = title;
            // bookmarkable
            window.location.hash = title;
        }
        edt_title.addEventListener("keydown", function(evt) {
            if (evt.code === "Enter") {
                edt_title.blur();
            }
        });
        // rename on Enter/blur of title editor
        edt_title.addEventListener("blur", title_change);
        // switch
        save_sel.addEventListener("change", function(){
            if (save_sel.value === "")
                return;
            save(title);
            load(save_sel.value);
        });
        // 'new'
        const btn_new = document.getElementById("new-file");
        btn_new.addEventListener("click", function(){
            // save current data
            save(title);
            const new_title = prompt("Name for new thing: ");
            if (new_title === "")
                return;
            clear();
            title = new_title;
            save(title);
            load(title);
            // bookmarkable
            window.location.hash = title;
        });
        //
        function to_ctx_coords(evt) {
            return [(evt.offsetX - pan[0])/zoom, (evt.offsetY - pan[1])/zoom];
        }
        function select_bubble(bubble) {
            const select = bubble && ! bubble.selected;
            // deselect all bubbles
            for (var nb=0; nb < bubbles.length; nb++)
                bubbles[nb].selected = false;
            if (bubble && select) {
                // select bubble
                bubble.selected = true;
                draw_bubble_form(bubble, panel);
                panel.style.display = 'block';
            } else {
                panel.innerText = "";
                panel.style.display = 'none';
            }
        }
        function create_bubble(at) {
            const c = r_colors[Math.floor(Math.random()*r_colors.length)];
            const bubble = new Bubble(at[0], at[1], 50, c);
            bubbles.push(bubble);
            select_bubble(bubble);
        }
        canvas.addEventListener("dblclick", function(evt) {
            create_bubble(to_ctx_coords(evt));
        });
        canvas.addEventListener("mousedown", function(evt){
            const pos = to_ctx_coords(evt);
            clicked = true;
            onbubble = overbubble(pos[0], pos[1]);
            select_bubble(onbubble);
            if (onbubble) {
                onbubble.dragging = true;
                onbubble.vx = 0;
                onbubble.vy = 0;
                start = [pos[0] - onbubble.x, pos[1] - onbubble.y];
            }
            move00 = [pos[0], pos[1], new Date().getTime()]
            move0 = move1 = null;
            pan0 = [pan[0], pan[1]];
        });
        canvas.addEventListener("mouseup", function(){
            clicked = false;
            if (onbubble) {
                onbubble.dragging = false;
                // 'throw' it
                if (move0 && move1) {
                    const dx = move1[0] - move0[0];
                    const dy = move1[1] - move0[1];
                    const dt = move1[2] - move0[2];
                    onbubble.vx += 20*dx*onbubble.weight / dt;
                    onbubble.vy += 20*dy*onbubble.weight / dt;
                }
            }
            onbubble = null;
        });
        canvas.addEventListener("mousemove", function(evt){
            const pos = to_ctx_coords(evt);
            const move = [pos[0], pos[1], new Date().getTime()]
            move0 = move1;
            move1 = move;
            if (onbubble) {
                // drag
                onbubble.x = pos[0] - start[0];
                onbubble.y = pos[1] - start[1];
            } else if (clicked) {
                // pan
                const dx = move[0] - move00[0];
                const dy = move[1] - move00[1];
                const z = zoom;
                // FIXME this is jumpy for some reason
                set_pan_zoom(pan0[0] + dx*z, pan0[1] + dy*z);
            }
        });
    }
    function frame() {
        const ctx = the_context;
        const z = zoom;
        //ctx.clearRect(-the_canvas.width/2, -the_canvas.height/2, the_canvas.width, the_canvas.height)
        ctx.clearRect(-pan[0]/z, -pan[1]/z, the_canvas.width/z, the_canvas.height/z)
        const t = new Date().getTime();
        const dt = Math.min(t - t0, 0.1);
        const friction = v_friction**dt;
        t0 = t;
        for (var nb=0; nb < bubbles.length; nb++){
            bubbles[nb].move(dt, friction);
            bubbles[nb].draw(ctx);
        }
    }
    function add_random_bubble() {
        var px = Math.random()*900 - 450;
        var py = Math.random()*900 - 450;
        var r = Math.random()*80 + 20;
        var c = r_colors[Math.floor(Math.random()*r_colors.length)];
        bubbles.push(new Bubble(px, py, r, c, ''));
    }
    function setup() {
        let mode = window.location.hash;
        if (mode.startsWith("#"))
            mode = mode.substring(1);
        mode = decodeURI(mode);
        const canvas = document.getElementById("view");
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        the_canvas = canvas;
        the_context = canvas.getContext('2d');
        set_pan_zoom(canvas.width/2, canvas.height/2, 1);
        // start bubble animations
        setInterval(function(){ frame(); }, 50);
        if (mode === "_demo_") {
            bubbles.push(new Bubble(0, 0, 140, 'blue', 'bubbles!', true));
            for (var nb=0; nb < 25; nb++)
                add_random_bubble();
            function updates() {
                if (Math.random() < 0.1 && bubbles.length < 40)
                    add_random_bubble();
                if (Math.random() < 0.1 && bubbles.length > 10) {
                    nb = Math.floor(Math.random()*(bubbles.length - 1)) + 1;
                    bubbles[nb].popping = 1;
                }
            }
            setInterval(updates, 150);
        } else {
            upd_saves();
            load(mode);
            // auto-save
            setInterval(function(){save(title);}, 5000);
            // introductory bubble
            if (! bubbles.length)
                bubbles.push(new Bubble(0, 0, 140, 'blue', 'double click to add a bubble\nclick to change or drag', true));
            // make bubbles draggable
            drag_and_select();
        }
    }
    window.addEventListener("load", setup);
})();

/*
 TODO...

 new / save-as / clear
 pan is jumpy
 choose which bubble to drift toward

 save slots
 better color chooser
 demo mode
 hover to see details
 ground-down mode, or place a boundary
 JIRA link per bubble

 instructions
   double click to create new bubble

 */