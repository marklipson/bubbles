//
function make_uuid() {
    if (typeof(crypto) != "undefined"  &&  typeof(crypto.randomUUID) != "undefined")
        return crypto.randomUUID();
    return Math.floor(Math.random()*2000000000).toString(36);
}
//
const _color_values = {};
function color_name_to_rgba(name) {
    if (! _color_values[name]) {
        var canvas = document.createElement('canvas');
        var context = canvas.getContext('2d');
        context.fillStyle = name;
        context.fillRect(0, 0, 1, 1);
        _color_values[name] = context.getImageData(0, 0, 1, 1).data;
    }
    return _color_values[name];
}
function rgb_to_hue(rgb) {
    const r = rgb[0] / 255;
    const g = rgb[1] / 255;
    const b = rgb[2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    // place grays after colors
    if (Math.abs(mx - mn) < 0.05)
        return 6 + Math.sqrt(r*r + g*g + b*b);
    // colors with a discernible hue
    let hue = 0;
    if (r === mx)
        hue = (g - b) / (mx - mn);
    else if (g === mx)
        hue = 2 + (b - r) / (mx - mn);
    else
        hue = 4 + (r - g) / (mx - mn);
    if (hue < 0)
        hue += 6;
    return hue;
}

/**
 * Click-and-hold adapter for buttons.  Calls first(), then repeatedly calls every() while clicked, then last().
 * @param button        Button to watch.
 * @param first         Called when clicked down.
 * @param every         Called while being held down.
 * @param last          Called when unclicked.
 * @param delay         Delay between calls while held down.
 */
function button_hold_events(button, first, every, last, delay=250) {
    let t_click = null;
    let tmr_every = null;
    let running = false;
    function on_every() {
        if (! running)
            return;
        const t_now = new Date().getTime() - t_click;
        if (t_now > 15000)
            stop();
        every();
        tmr_every = setTimeout(on_every, delay);
    }
    function start() {
        running = true;
        t_click = new Date().getTime();
        if (every)
            tmr_every = setTimeout(on_every, delay);
        if (first)
            first();
    }
    function stop() {
        if (! running)
            return;
        running = false;
        clearTimeout(tmr_every);
        if (last)
            last();
    }
    button.addEventListener("mousedown", start);
    button.addEventListener("mouseup", stop);
    button.addEventListener("mouseout", stop);
    button.addEventListener("blur", stop);
}

/**
 * Do something every interval while button is clicked.
 */
function button_repeater(button, fn, delay) {
    return button_hold_events(button, fn, fn, null, delay);
}

/**
 * Logarithmically or liearly adjust a value.
 */
function edit_value(name, getter, setter, area, vmin, vmax) {
    const edit = document.createElement("input");
    edit.setAttribute("type", "number");
    function set_v(vw) {
        vw = Math.min(vw, vmax);
        vw = Math.max(vw, vmin);
        vw = Math.round(vw*100)/100;
        setter(vw);
        edit.value = vw.toFixed(2);
    }
    edit.addEventListener("change", function() {
        set_v(parseFloat(edit_weight.value));
    })
    set_v(getter());
    const btn_up = document.createElement("button");
    btn_up.setAttribute("title", "Increase " + name);
    btn_up.innerText = "+"
    button_repeater(btn_up, function(){
        if (vmin <= 0)
            set_v(getter() + 0.5);
        else
            set_v(getter() * 1.15);
    }, 300);
    const btn_down = document.createElement("button");
    btn_down.setAttribute("title", "Decrease " + name);
    btn_down.innerText = "-"
    button_repeater(btn_down, function(){
        if (vmin <= 0)
            set_v(getter() - 0.5);
        else
            set_v(getter() / 1.15);
    }, 300);
    const lbl = document.createElement("span");
    lbl.className = "edit-value-label"
    lbl.innerText = name;
    area.appendChild(lbl);
    area.appendChild(btn_down);
    area.appendChild(edit);
    area.appendChild(btn_up);
}

/**
 * Choose a color.
 */
function choose_color(getter, setter, area, colors) {
    const boxes = [];
    function upd(c) {
        setter(c);
        for (var n=0; n < boxes.length; n++) {
            if (boxes[n].getAttribute("data-color") === c) {
                //boxes[n].style.borderColor = "black";
                boxes[n].style.boxShadow = "#404040 0px 3px 0px";
            } else {
                //boxes[n].style.borderColor = "rgba(0,0,0,0)";
                boxes[n].style.boxShadow = "";
            }
        }
    }
    for (var n=0; n < colors.length; n++) {
        const box = document.createElement("span");
        box.innerText = "\u00a0";
        box.style.display = "inline-block";
        box.style.cursor = "pointer";
        box.style.width = "16px";
        box.style.height = "16px";
        box.style.marginBottom = "6px";
        //box.style.border = "solid 2px 2px 0 2px rgba(0,0,0,0)";
        box.style.backgroundColor = colors[n];
        box.setAttribute("data-color", colors[n]);
        box.addEventListener("click", function(evt){
            const c = evt.target.getAttribute("data-color");
            upd(c);
        });
        boxes.push(box);
        area.appendChild(box);
    }
    upd(getter());
}

/**
 * Smooth a 'circular' array, i.e. one representing radii/etc. around an object.
 * @param surface       Array of numerics.
 * @param fuzz          Number of smoothing iterations.
 */
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

/**
 * Add a single force to a set of named forces.
 *
 * @param forces        A {} mapping name/UUID to [fx, fy]
 * @param target        UUID to apply force to.
 * @param fx            Amount of force.
 * @param fy            Amount of force.
 */
function add_force(forces, target, fx, fy) {
    let f = forces[target];
    if (! f)
        forces[target] = f = [0, 0];
    f[0] += fx;
    f[1] += fy;
}

